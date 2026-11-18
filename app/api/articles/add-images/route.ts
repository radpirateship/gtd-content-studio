import { type NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { generateImageWithModel, type ImageModel, IMAGE_MODEL_LABELS } from "@/lib/imageGeneration";
import { extractImageUrl } from "@/lib/imageUtils";
import { uploadDataUriToShopify } from "@/lib/shopifyImageUpload";
import sharp from "sharp"; // FIX: Static import so Vercel bundles the native Sharp binary correctly.
                           // Dynamic import with webpackIgnore fails on Vercel serverless functions.

// WHY 180s: We generate 3 images sequentially (~75s worst case), then upload
// all 3 to Shopify Files in PARALLEL (~37s worst case). Total ~112s < 180s.
// Previous timeout bug: uploads were happening INSIDE the generation loop,
// causing worst-case 256s sequential execution which exceeded the limit.
export const maxDuration = 180;

async function compressToDataUri(url: string): Promise<string> {
  if (!url.startsWith("data:")) return url;

  try {
    const b64 = url.replace(/^data:[^;]+;base64,/, "");
    const buf = Buffer.from(b64, "base64");
    const compressed = await sharp(buf)
      .resize({ width: 1200, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    const result = `data:image/jpeg;base64,${compressed.toString("base64")}`;
    console.log(
      `[add-images] Compressed: ${Math.round(buf.length / 1024)}KB → ${Math.round(compressed.length / 1024)}KB`
    );
    return result;
  } catch (e) {
    console.error("[add-images] Compression failed, using raw:", e);
    return url;
  }
}

// Shorter style suffix to avoid prompt length issues
// Kept short because the prompt is trimmed to 150 chars before this is appended,
// but the palette is pinned so images match the blog template. Full spec lives
// in lib/ppw-image-style.ts.
const STYLE_SUFFIX =
  "Clean modern editorial style on white or #FAF7F1, navy #09195B dominant, muted gold #C8A96E accent, no dark backgrounds, no neon, no text overlays.";

/**
 * Extract H2 sections from the article and build targeted image prompts.
 * Each prompt is tagged with the section ID it should be injected into.
 * Skips FAQ, key-takeaways, featured-products, and CTA sections.
 */
function extractSectionPrompts(
  htmlContent: string,
  category: string,
  targetCount = 5,
): { prompt: string; sectionId: string; heading: string; altText: string }[] {
  const h2Regex = /<h2[^>]*(?:id="([^"]*)")?[^>]*>(.*?)<\/h2>/gi;
  const sections: { id: string; text: string }[] = [];
  let match;
  while ((match = h2Regex.exec(htmlContent) as RegExpExecArray | null) !== null) {
    const text = match[2].replace(/<[^>]+>/g, "").trim();
    const id =
      match[1] ||
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    // Skip anything that is not a prose section. "picks" and "more-picks" are
    // the template_version 2 product grids; without them here an image gets
    // injected between the heading and the product cards.
    const isBlock = /faq|key-takeaway|continue-your|featured-product|shop|^picks$|^more-picks$|keep-reading/.test(id);
    const isBlockText = /frequently asked|key takeaways|keep reading|to start with|worth a look/i.test(text);
    if (!isBlock && !isBlockText) {
      sections.push({ id, text });
    }
  }

  // Images per article. Raised from 3 to 5 (Aug 2026): they break up a
  // 2,500-word body far better than three do, and generation is now run in
  // parallel batches so the extra two do not push past the 180s Vercel limit.
  const maxImages = Math.min(targetCount, sections.length);
  const step = Math.max(1, Math.floor(sections.length / maxImages));
  const selected: { prompt: string; sectionId: string; heading: string; altText: string }[] = [];

  for (let i = 0; i < sections.length && selected.length < maxImages; i += step) {
    const s = sections[i];
    const isFirst = selected.length === 0;
    const prompt = isFirst
      ? `Cinematic featured photograph for article section "${s.text}" about ${category}, professional lighting, magazine cover quality`
      : `Technical illustration or educational diagram related to "${s.text}" in the context of ${category}, precise visual details`;
    const altText = isFirst
      ? `Professional photograph illustrating ${s.text.toLowerCase()} for ${category}`
      : `Technical diagram showing ${s.text.toLowerCase()} concepts for ${category}`;
    selected.push({ prompt, sectionId: s.id, heading: s.text, altText });
  }

  console.log(
    `[add-images] Built ${selected.length} section-targeted prompts from ${sections.length} sections`
  );
  return selected;
}

/**
 * POST /api/articles/add-images
 *
 * Takes article HTML, generates images via Gemini, uploads them to Shopify
 * Files CDN, and inserts the permanent CDN URLs into the HTML.
 *
 * Flow:
 *   1. Extract 3 target sections from H2 headings
 *   2. Generate 3 images sequentially (avoids Gemini rate limits)
 *   3. Compress each image with Sharp
 *   4. Upload ALL 3 compressed images to Shopify Files IN PARALLEL (key fix)
 *   5. Insert permanent cdn.shopify.com URLs into the article HTML
 */
export async function POST(request: NextRequest) {
  try {
    const { articleId, htmlContent, category, imageCount } = await request.json();

    if (!htmlContent) {
      return NextResponse.json({ error: "htmlContent is required" }, { status: 400 });
    }

    const imageModel: ImageModel = "gemini-3.1-flash-image-preview";

    if (!process.env.GEMINI_API_KEY) {
      console.error("[add-images] GEMINI_API_KEY is not set!");
      return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const targetImages = Math.max(1, Math.min(8, Number(imageCount ?? 5)));
    const sectionPrompts = extractSectionPrompts(htmlContent, category || "wellness", targetImages);

    if (sectionPrompts.length === 0) {
      return NextResponse.json({
        htmlContent,
        imageCount: 0,
        message: "No eligible article sections found for images.",
        success: true,
      });
    }

    console.log(
      `[add-images] Generating ${sectionPrompts.length} images using ${IMAGE_MODEL_LABELS[imageModel]}`
    );

    let enrichedHTML = htmlContent;

    // Clean up any legacy placeholder artifacts
    enrichedHTML = enrichedHTML.replace(
      /<img[^>]*src="?\[IMAGE_PLACEHOLDER_\d+\]"?[^>]*\/?>/gi,
      ""
    );
    enrichedHTML = enrichedHTML.replace(/\[IMAGE_PLACEHOLDER_\d+\]/g, "");

    // Strip any images inside product card blocks (safety)
    enrichedHTML = enrichedHTML.replace(
      /(<div[^>]*class="[^"]*ppw-product-card[^"]*"[^>]*>)([\s\S]*?)(<\/div>\s*<\/div>\s*<\/div>)/gi,
      (match: string) =>
        match.replace(/<figure[^>]*class="ppw-content-image"[^>]*>[\s\S]*?<\/figure>/gi, "")
    );

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // ── PHASE 1: Generate images in small parallel batches ────────────────
    // Was fully sequential with a 1.5s gap, which capped the article at 3
    // images inside the 180s function limit. Batches of 2 keep well clear of
    // Gemini rate limits while letting 5 images finish in roughly the time 3
    // used to take. Order is preserved; a failure only drops its own image.
    console.log("[add-images] Phase 1: Generating images in parallel batches...");
    const rawImages: {
      dataUri: string;
      sectionId: string;
      heading: string;
      altText: string;
      provider: string;
    }[] = [];

    const BATCH = 2;

    const generateOne = async (sp: typeof sectionPrompts[number], idx: number) => {
      const trimmedPrompt = sp.prompt.length > 150 ? sp.prompt.slice(0, 150).trim() : sp.prompt;
      const fullPrompt = `${trimmedPrompt}. ${STYLE_SUFFIX}`;
      console.log(`[add-images] Generating image ${idx + 1}/${sectionPrompts.length} for section "${sp.sectionId}"...`);

      let result = await generateImageWithModel(fullPrompt, imageModel, {
        style: "realistic_image",
        imageSize: "landscape_16_9",
        aspectRatio: "16:9",
      });

      if (!result) {
        console.warn(`[add-images] Image ${idx + 1} failed — retrying with simpler prompt...`);
        await delay(2000);
        result = await generateImageWithModel(
          `${sp.heading}, professional product photo, white background`,
          imageModel,
          { style: "realistic_image", imageSize: "landscape_16_9", aspectRatio: "16:9" },
        );
      }
      if (!result) {
        console.error(`[add-images] Image ${idx + 1} failed after retry — skipping`);
        return null;
      }
      const compressed = await compressToDataUri(result.url);
      console.log(`[add-images] Image ${idx + 1} generated and compressed`);
      return {
        dataUri: compressed,
        sectionId: sp.sectionId,
        heading: sp.heading,
        altText: sp.altText,
        provider: result.provider,
      };
    };

    for (let i = 0; i < sectionPrompts.length; i += BATCH) {
      if (i > 0) await delay(1200);
      const slice = sectionPrompts.slice(i, i + BATCH);
      const settled = await Promise.all(slice.map((sp, n) => generateOne(sp, i + n)));
      for (const r of settled) if (r) rawImages.push(r);
    }

    console.log(
      `[add-images] Phase 1 complete: ${rawImages.length}/${sectionPrompts.length} images generated`
    );

    // ── PHASE 2: Upload ALL images to Shopify CDN in parallel ─────────────────
    // Parallel uploads mean 3 images take as long as 1 (~37s worst case).
    // This is the key fix — previously uploads happened inside the generation
    // loop (sequential), causing timeouts on the 180s Vercel function limit.
    console.log(
      `[add-images] Phase 2: Uploading ${rawImages.length} images to Shopify CDN in parallel...`
    );

    const uploadResults = await Promise.all(
      rawImages.map(async (img, idx) => {
        try {
          const cdnUrl = await uploadDataUriToShopify(img.dataUri, img.altText);
          console.log(
            `[add-images] Image ${idx + 1} uploaded to CDN: ${cdnUrl.slice(0, 70)}...`
          );
          return { ...img, finalUrl: cdnUrl, uploadSuccess: true };
        } catch (err) {
          console.error(
            `[add-images] Image ${idx + 1} Shopify upload FAILED:`,
            err instanceof Error ? err.message : err
          );
          // Keep the compressed data URI as last-resort fallback.
          // The publish route's replaceWithShopifyImages() will try again at publish time.
          return { ...img, finalUrl: img.dataUri, uploadSuccess: false };
        }
      })
    );

    const uploadedCount = uploadResults.filter((r) => r.uploadSuccess).length;
    const fallbackCount = uploadResults.filter((r) => !r.uploadSuccess).length;
    console.log(
      `[add-images] Phase 2 complete: ${uploadedCount} CDN uploads, ${fallbackCount} fallback to base64`
    );

    if (fallbackCount > 0) {
      console.warn(
        `[add-images] WARNING: ${fallbackCount} images fell back to base64. ` +
          `Check Vercel logs for Shopify upload errors. ` +
          `replaceWithShopifyImages() will retry at publish time.`
      );
    }

    // ── PHASE 3: Insert images into HTML ──────────────────────────────────────
    let insertedCount = 0;
    for (const img of uploadResults) {
      if (!img.finalUrl) continue;

      const cleanUrl = extractImageUrl(img.finalUrl);
      if (!cleanUrl) continue;

      const altText = (img.altText || img.heading).replace(/"/g, "&quot;");
      // ppw-content-image is a v1 class defined in no current stylesheet, so on
      // a v2 article the figure rendered unstyled. Match the article's version.
      const figClass = /class=["'][^"']*ppwb-/.test(enrichedHTML) ? "ppwb-fig" : "ppw-content-image";
      const figureTag = `\n<figure class="${figClass}"><img src="${cleanUrl}" alt="${altText}" loading="lazy" /></figure>\n`;

      const escapedId = img.sectionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const sectionRegex = new RegExp(
        `(<h2[^>]*id="${escapedId}"[^>]*>[\\s\\S]*?<\\/h2>)`,
        "i"
      );
      const sectionMatch = sectionRegex.exec(enrichedHTML);

      if (sectionMatch) {
        const insertPos = sectionMatch.index + sectionMatch[0].length;
        const before = enrichedHTML.slice(Math.max(0, insertPos - 500), insertPos);
        // ppwb-pick is the v2 product card; without it the guard passes and an
        // image is inserted into the middle of the picks grid.
        if (!before.includes("ppw-product-card") && !before.includes("featured-products")
            && !before.includes("ppwb-pick") && !before.includes("ppwb-picks")) {
          enrichedHTML =
            enrichedHTML.slice(0, insertPos) + figureTag + enrichedHTML.slice(insertPos);
          insertedCount++;
          console.log(`[add-images] Inserted image after section "${img.sectionId}"`);
        }
      } else {
        console.log(
          `[add-images] Could not find section "${img.sectionId}" in HTML — image skipped`
        );
      }
    }

    console.log(
      `[add-images] Complete: ${insertedCount} images inserted into HTML ` +
        `(${uploadedCount} CDN URLs, ${fallbackCount} base64 fallbacks)`
    );

    // Update database if articleId provided
    if (articleId) {
      try {
        const sql = getSQL();
        await sql`
          UPDATE articles
          SET html_content = ${enrichedHTML},
              has_images = ${insertedCount > 0},
              image_count = ${insertedCount},
              updated_at = NOW()
          WHERE id = ${articleId}
        `;
      } catch (dbError) {
        console.error("[add-images] DB update failed:", dbError);
      }
    }

    return NextResponse.json({
      htmlContent: enrichedHTML,
      imageCount: insertedCount,
      uploadedToCDN: uploadedCount,
      fallbackBase64: fallbackCount,
      model: imageModel,
      success: true,
    });
  } catch (error) {
    console.error("[add-images] Fatal error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add images" },
      { status: 500 }
    );
  }
}
