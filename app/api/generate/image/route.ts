import { type NextRequest, NextResponse } from "next/server";
import { generateImageWithModel, type ImageModel } from "@/lib/imageGeneration";

/**
 * POST /api/generate/image
 * Featured image generation for the Shopify blog post featured_image field.
 * Uses Gemini image generation.
 */
export async function POST(request: NextRequest) {
  try {
    const { title, category, style = "photorealistic", model = "gemini-3.1-flash-image-preview" } = await request.json();

    const imagePrompt = generateImagePrompt(title, category, style);
    const imageModel: ImageModel = 'gemini-3.1-flash-image-preview';

    console.log(`[featured-image] Generating with ${imageModel}`);

    const result = await generateImageWithModel(imagePrompt, imageModel, {
      style: 'realistic_image',
      imageSize: 'landscape_16_9',
      aspectRatio: '16:9',
    });

  if (result) {
    let finalUrl = result.url;

    // Step 1: Get image as buffer (from data URI or fetch URL)
    let imgBuffer: Buffer | null = null;
    try {
      if (finalUrl.startsWith('data:')) {
        const b64 = finalUrl.replace(/^data:[^;]+;base64,/, '');
        imgBuffer = Buffer.from(b64, 'base64');
      } else {
        const resp = await fetch(finalUrl);
        if (resp.ok) imgBuffer = Buffer.from(await resp.arrayBuffer());
      }
    } catch (e) { console.error('[featured-image] Failed to get image buffer:', e); }

    // Step 2: Resize, overlay title text, and compress with sharp
    if (imgBuffer) {
      try {
        const mod = 'sharp';
        const sharp = (await import(/* webpackIgnore: true */ mod)).default;
        const originalSize = imgBuffer.length;

        // Resize to standard featured image dimensions
        let pipeline = sharp(imgBuffer).resize({ width: 1200, height: 675, fit: 'cover', withoutEnlargement: false });

        // Overlay article title text if provided
        if (title) {
          const escapedTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
          // Word-wrap title to ~30 chars per line
          const words = escapedTitle.split(' ');
          const lines: string[] = [];
          let currentLine = '';
          for (const word of words) {
            if ((currentLine + ' ' + word).trim().length > 30 && currentLine) {
              lines.push(currentLine.trim());
              currentLine = word;
            } else {
              currentLine = (currentLine + ' ' + word).trim();
            }
          }
          if (currentLine) lines.push(currentLine.trim());

          const fontSize = lines.length > 3 ? 36 : 42;
          const lineHeight = fontSize * 1.3;
          const textBlockHeight = lines.length * lineHeight;
          const yStart = (675 - textBlockHeight) / 2;

          const tspans = lines.map((line, i) =>
            `<tspan x="600" dy="${i === 0 ? 0 : lineHeight}" text-anchor="middle">${line}</tspan>`
          ).join('');

          const svgOverlay = Buffer.from(`
            <svg width="1200" height="675">
              <rect x="0" y="0" width="1200" height="675" fill="rgba(0,0,0,0.45)" rx="0"/>
              <text x="600" y="${yStart + fontSize}" font-family="Georgia, serif" font-size="${fontSize}" font-weight="bold" fill="white" text-anchor="middle" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.5))">
                ${tspans}
              </text>
            </svg>
          `);

          pipeline = pipeline.composite([{ input: svgOverlay, top: 0, left: 0 }]);
          console.log(`[featured-image] Title overlay applied: "${title.slice(0, 50)}..."`);
        }

        const compressed = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
        finalUrl = `data:image/jpeg;base64,${compressed.toString('base64')}`;
        console.log(`[featured-image] Processed: ${Math.round(originalSize/1024)}KB → ${Math.round(compressed.length/1024)}KB`);
      } catch (e) { console.error('[featured-image] Processing failed, using raw:', e); }
    }

    return NextResponse.json({
      image: finalUrl,
      prompt: imagePrompt,
      provider: result.provider,
      model: result.model,
    });
  }

    return NextResponse.json({ image: null, placeholder: true, prompt: imagePrompt, message: "Image generation unavailable." });
  } catch (error) {
    console.error("Featured image generation error:", error);
    return NextResponse.json({ image: null, placeholder: true, message: "Image generation failed." });
  }
}

function generateImagePrompt(title: string, category: string, style: string): string {
  const categoryPrompts: Record<string, string> = {
    "float-tanks": "serene float tank room with soft blue ambient lighting, modern spa aesthetic, sensory deprivation pod, calm water surface, minimalist wellness center interior",
    saunas: "luxurious wooden sauna interior with warm amber lighting, steam rising gently, cedar wood panels, wellness spa atmosphere, relaxation space",
    "cold-plunge": "modern cold plunge pool with clean lines, ice bath setup, professional wellness facility, refreshing cold therapy equipment, contemporary design",
    "red-light-therapy": "red light therapy panel glowing warmly, modern wellness equipment, professional treatment room, LED therapy device, health optimization",
    "hyperbaric-chambers": "modern hyperbaric oxygen chamber in professional medical wellness facility, clean white interior, advanced health technology",
    "massage-equipment": "professional massage therapy room with modern equipment, wellness center, relaxation atmosphere, therapeutic setting",
    "recovery-tools": "professional athletic recovery room with modern equipment, sports therapy space, wellness center, health optimization facility",
    "general-wellness": "modern wellness center interior, holistic health space, clean minimalist design, natural light, calming atmosphere",
    steam: "luxurious steam shower enclosure with glass panels, warm steam filling the space, modern bathroom design with stone tile, steam generator equipment, spa-like home bathroom, chrome fixtures, ambient warm lighting",
  };

  const basePrompt = categoryPrompts[category] || categoryPrompts["general-wellness"];
  const styleModifier = style === "photorealistic"
    ? "professional photography, high quality, realistic, editorial style"
    : "artistic illustration, modern graphic design, clean lines";

  return `${basePrompt}, inspired by the topic "${title}", ${styleModifier}, absolutely no text, no words, no letters, no logos, no watermarks, no writing of any kind, wellness and health theme, premium editorial quality, soft natural lighting`;
}
