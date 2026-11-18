// lib/revamp-v2.ts
// Helpers for updating a published v1 article onto the v2 system while
// keeping its existing images. Regeneration writes a fresh v2 body with no
// images (images are a separate, expensive step); these helpers carry the
// old article's images into the new body so the image step can be skipped
// for posts whose images are worth keeping.
//
// All deterministic. Guards repair, not warn.

export type CarriedImage = { src: string; alt: string };

const fmtDate = (d: Date) =>
  `${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]} ${d.getFullYear()}`;

function stripStylesScripts(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");
}

/**
 * Pull the content images out of a legacy article body.
 * Excluded: product-card images (class or nearby markup names "product"),
 * logos and icons, data URIs, tracking pixels (tiny width/height), and
 * duplicate srcs. Order of appearance is preserved, because it encodes the
 * author's intent for where in the narrative each image belongs.
 */
export function extractLegacyImages(oldBodyHtml: string, max = 12): CarriedImage[] {
  const clean = stripStylesScripts(oldBodyHtml || "");
  const out: CarriedImage[] = [];
  const seen = new Set<string>();

  for (const m of clean.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = (tag.match(/\bsrc="([^"]+)"/i) || [])[1] || "";
    if (!src || src.startsWith("data:")) continue;

    const cls = (tag.match(/\bclass="([^"]*)"/i) || [])[1] || "";
    if (/product|logo|icon|avatar|badge/i.test(cls)) continue;

    // Skip images that live inside a product card or product link: look at a
    // window of markup before the tag for the telltale wrappers.
    const start = Math.max(0, (m.index || 0) - 400);
    const before = clean.slice(start, m.index || 0);
    if (/class="[^"]*(?:product|ppw-card|ppwb-pick)[^"]*"[^>]*>(?:(?!<\/(?:div|section|a)>)[\s\S])*$/i.test(before)) continue;
    if (/<a\b[^>]*href="[^"]*\/products\/[^"]*"[^>]*>(?:(?!<\/a>)[\s\S])*$/i.test(before)) continue;

    const w = parseInt((tag.match(/\bwidth="?(\d+)/i) || [])[1] || "0", 10);
    const h = parseInt((tag.match(/\bheight="?(\d+)/i) || [])[1] || "0", 10);
    if ((w && w <= 100) || (h && h <= 100)) continue;

    const key = src.split("?")[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const alt = (tag.match(/\balt="([^"]*)"/i) || [])[1] || "";
    out.push({ src, alt });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Insert carried images into a v2 body: one per content section, after the
 * first closed paragraph that follows each `ppwb-h2` whose id starts with
 * "section" (the assembled blocks, FAQ, picks, glance, shop and author, keep
 * their own ids and are never touched). Images that outnumber sections are
 * dropped rather than stacked; the first sections get served first.
 */
export function insertImagesIntoV2Body(
  bodyHtml: string,
  images: CarriedImage[]
): { bodyHtml: string; carried: number } {
  if (!images.length) return { bodyHtml, carried: 0 };

  const h2Re = /<h2\b[^>]*class="[^"]*ppwb-h2[^"]*"[^>]*\bid="(section[^"]*)"[^>]*>/gi;
  const slots: number[] = [];
  for (const m of bodyHtml.matchAll(h2Re)) {
    const afterH2 = (m.index || 0) + m[0].length;
    const pEnd = bodyHtml.indexOf("</p>", afterH2);
    if (pEnd !== -1) slots.push(pEnd + 4);
  }
  if (!slots.length) return { bodyHtml, carried: 0 };

  let out = "";
  let prev = 0;
  let carried = 0;
  for (let i = 0; i < slots.length && carried < images.length; i++) {
    const img = images[carried];
    out += bodyHtml.slice(prev, slots[i]);
    out += `\n<figure class="ppwb-figure"><img src="${img.src}" alt="${img.alt.replace(/"/g, "&quot;")}" loading="lazy" /></figure>`;
    prev = slots[i];
    carried++;
  }
  out += bodyHtml.slice(prev);
  return { bodyHtml: out, carried };
}

/**
 * Rewrite the header meta line for an updated post: keep the ORIGINAL
 * published date (the URL and its history are the asset) and append a
 * visible "Updated" date. Runs on the assembled v2 document, which carries
 * exactly one "Published ..." span inside `ppwb-meta`. If the pattern is
 * missing (header variant, manual edit) the body is returned unchanged.
 */
export function applyUpdatedLine(
  bodyHtml: string,
  originalPublishedAt: string | Date | null,
  updatedAt: Date = new Date()
): string {
  if (!originalPublishedAt) return bodyHtml;
  const orig = new Date(originalPublishedAt);
  if (isNaN(orig.getTime())) return bodyHtml;
  return bodyHtml.replace(
    /<span>Published [^<]*<\/span>/,
    `<span>Published ${fmtDate(orig)}</span>\n<i class="ppwb-meta-dot"></i>\n<span>Updated ${fmtDate(updatedAt)}</span>`
  );
}
