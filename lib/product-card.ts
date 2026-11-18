// Shared product-card markup builder — single source for the featured
// products grid across workshop regenerate and product swap. Markup must
// match app/api/generate/route.ts card output.
//
// FIXED Aug 3 2026: this module previously called assignBadge(), getShortName()
// and extractFeatures() without defining or importing any of them. Because
// next.config.mjs sets typescript.ignoreBuildErrors, the build passed and both
// callers (/api/workshop/regenerate and /api/workshop/swap-products) threw a
// ReferenceError at runtime instead. The helpers are now defined here so the
// module is self-contained.
//
// CLAIMS POLICY: no bullet may promise white-glove delivery or assembly (GTD
// does not offer it) or blanket free shipping (conditional on product class,
// not offered on freight items such as saunas).
//
// CARD COMPOSITION: 2 product-specific specs + 1 service line = 3 bullets.
// SERVICE_BULLET in lib/product-bullets.ts is the canonical wording; it is
// written out literally here to keep the audit module off the generation path.
// lib/product-bullets.ts strips stale claims from already-published articles.

const SERVICE_BULLET = "Ongoing US-Based Phone Support";

const BADGE_CHEAPEST = { label: "Great Starting Point", color: "#16a34a" };
const BADGE_TOP_PICK = { label: "Top Pick", color: "#dc2626" };
const BADGE_PREMIUM = { label: "Premium Choice", color: "#9333ea" };
const BADGE_COMMERCIAL = { label: "Commercial Grade", color: "#ea580c" };

export function assignBadge(
  products: { price?: string }[],
  index: number
): { label: string; color: string } {
  if (products.length <= 1) return BADGE_TOP_PICK;
  const priceRanked = products
    .map((p, i) => ({ i, price: parseFloat(p.price || "0") || 0 }))
    .sort((a, b) => a.price - b.price);
  const rank = priceRanked.findIndex((r) => r.i === index);
  const total = priceRanked.length;
  if (rank === 0) return BADGE_CHEAPEST;
  if (rank === total - 1) return BADGE_COMMERCIAL;
  if (rank === 1) return BADGE_TOP_PICK;
  return BADGE_PREMIUM;
}

export function getShortName(title: string): string {
  const cleaned = title
    .replace(
      /^(dynamic|maxxus|golden designs|sun home|medical breakthrough|therasage|echo|tyent|life)\s+/i,
      ""
    )
    .replace(/\s+(low emf|far ir|infrared|sauna|cold plunge|red light|therapy)\s*$/i, "")
    .trim();
  const words = cleaned.split(/\s+/).slice(0, 3);
  return words.join(" ") || title.split(/\s+/).slice(0, 2).join(" ");
}

const FEATURE_MAP: [RegExp, string][] = [
  [/low[\s-]?emf/i, "Low EMF Certified"],
  [/full[\s-]?spectrum/i, "Full Spectrum Heating"],
  [/chromotherapy/i, "Chromotherapy Lighting"],
  // "bluetooth" alone is data connectivity, not audio. Matching it as an audio
  // system put "Built-In Audio System" on smart jump ropes.
  [/speaker|built[\s-]?in[\s-]?audio|sound[\s-]?system|premium[\s-]?audio/i, "Built-In Audio System"],
  [/bluetooth/i, "Bluetooth Connectivity"],
  [/carbon[\s-]?heat/i, "Carbon Heating Panels"],
  [/ceramic[\s-]?heat/i, "Ceramic Heaters"],
  [/canadian[\s-]?(red\s)?cedar/i, "Canadian Cedar Construction"],
  [/hemlock/i, "Hemlock Wood Construction"],
  [/dual[\s-]?wall/i, "Premium Dual-Wall Build"],
  [/stainless[\s-]?steel/i, "Stainless Steel Construction"],
  [/insulated/i, "Enhanced Insulation"],
  [/wifi|wi-fi|app[\s-]?control/i, "WiFi & App Control"],
  [/touch[\s-]?screen|touchscreen/i, "Touchscreen Controls"],
  [/corner[\s-]?design/i, "Space-Saving Corner Design"],
  [/outdoor/i, "Outdoor-Rated Design"],
  [/barrel/i, "Classic Barrel Design"],
  [/\b(\d+)[\s-]?person/i, "$1-Person Capacity"],
  [/portable/i, "Portable Design"],
  [/foldable|fold[\s-]?up/i, "Foldable for Easy Storage"],
  [/chiller|cooling/i, "Active Cooling System"],
  [/ozone[\s-]?(?:generator|sanit)|uv[\s-]?ozone/i, "Ozone Sanitization"],
  [/(\d+)[\s-]?micron/i, "$1-Micron Filtration"],
  [/hydrogen[\s-]?rich/i, "Hydrogen-Rich Water"],
  [/alkaline/i, "Alkaline Water System"],
  [/red[\s-]?light|led[\s-]?panel/i, "Medical-Grade LEDs"],
  [/(\d+)\s*(?:nm|nanometer)/i, "Targeted Wavelength Therapy"],
  [/fiberglass|gel[\s-]?coat/i, "Fiberglass Shell Construction"],
  [/soundproof|acoustic/i, "Soundproofed Float Environment"],
  [/commercial[\s-]?grade|commercial use/i, "Commercial-Grade Build"],
  [/uv[\s-]?sanitiz|uv light/i, "UV Sanitization System"],
  [/([\d.]+)\s*ata/i, "$1 ATA Pressure"],
  [/steam[\s-]?generator|steam[\s-]?shower/i, "Integrated Steam Generator"],
  [/eucalyptus|aromatherapy/i, "Aromatherapy Compatible"],
  [/\b([1-9]\d?(?:\.\d)?)[\s-]?kw\b/i, "$1kW Power Output"],
  // Cardio and strength. The original map had no entries for these at all, so
  // rower, treadmill, bike and elliptical round-ups matched nothing and every
  // card fell through to generic filler bullets.
  [/water[\s-]?(?:flywheel|resistance|rowing)|water[\s-]?tank/i, "Water Resistance Flywheel"],
  [/air[\s-]?resistance|air[\s-]?flywheel|damper[\s-]?setting/i, "Air Resistance Flywheel"],
  [/magnetic[\s-]?resistance/i, "Magnetic Resistance"],
  [/pm5|pm4|performance[\s-]?monitor|console[\s-]?display/i, "Performance Monitor Console"],
  [/solid[\s-]?(?:ash|oak|cherry|walnut|hardwood)|hardwood[\s-]?frame/i, "Solid Hardwood Frame"],
  [/upright[\s-]?storage|stores?[\s-]?upright|vertical[\s-]?storage/i, "Stores Upright"],
  // "weight" was in this alternation and matched "250 lb weight stacks" on a
  // functional trainer, so its card claimed "250 lb User Capacity" when 250 lb
  // is the stack, not the user limit. Only user/max phrasing earns the label.
  [/\b(\d{3})\s*lb(?:s)?\s*(?:user|max\s*(?:user|weight)?\s*(?:capacity|limit))/i, "$1 lb User Capacity"],
  [/\b(\d{3})\s*lb(?:s)?\s*weight\s*stacks?/i, "$1 lb Weight Stack"],
  [/incline/i, "Adjustable Incline"],
  [/cushioned[\s-]?deck|running[\s-]?deck|shock[\s-]?absorb/i, "Cushioned Running Deck"],
  [/heart[\s-]?rate|hr[\s-]?monitor|pulse[\s-]?sensor/i, "Heart Rate Monitoring"],
  [/resistance[\s-]?levels?/i, "Multiple Resistance Levels"],
];

/**
 * Feature bullets for a product card: 2 product-specific specs plus the service
 * line. Curated bullets from the product_bullets table win when present, since
 * those were drafted from the full Shopify description and reviewed by a human.
 */
export function extractFeatures(product: {
  title: string;
  description?: string;
  tags?: string;
  vendor?: string;
  bullets?: string[];
}): string[] {
  // Curated rows hold product specs only; the service line is appended here.
  if (product.bullets && product.bullets.length > 0) {
    return [...product.bullets.slice(0, 2), SERVICE_BULLET];
  }

  const features: string[] = [];
  const combined = `${product.title || ""} ${product.description || ""} ${product.tags || ""}`.toLowerCase();

  for (const [pattern, label] of FEATURE_MAP) {
    if (features.length >= 2) break;
    if (!pattern.test(combined)) continue;
    const match = combined.match(pattern);
    const resolved = label.includes("$1") && match?.[1] ? label.replace("$1", match[1]) : label;
    if (!features.includes(resolved)) features.push(resolved);
  }

  const trimmed = features.slice(0, 2);

  // Fill only what the product data could not supply. Never "free shipping"
  // (conditional on product class, not offered on freight items such as
  // saunas) and never a white-glove or assembly promise, neither of which GTD
  // offers. A card showing this filler means the Shopify description is thin;
  // /product-bullets surfaces those for a manual spec.
  if (trimmed.length < 2) trimmed.push("Quality Inspected Before Shipping");
  trimmed.push(SERVICE_BULLET);

  return trimmed.slice(0, 3);
}

export function buildProductCard(product: {
  title: string;
  description?: string;
  price?: string;
  imageUrl?: string;
  url?: string;
  handle?: string;
  vendor?: string;
  tags?: string;
  bullets?: string[];
}, index: number, allProducts: { price?: string }[]): string {
  const badge = assignBadge(allProducts, index);
  const productUrl = product.handle ? `/products/${product.handle}` : (product.url || "#");
  const shortName = getShortName(product.title);
  const features = extractFeatures(product);

  const imageHtml = product.imageUrl
    ? `<div class="gtd-product-image-container"><img src="${product.imageUrl}" alt="${product.title}" class="gtd-product-image" loading="lazy" /></div>`
    : "";

  let priceHtml = "";
  if (product.price) {
    const numPrice = parseFloat(product.price);
    if (!isNaN(numPrice) && numPrice > 0) {
      const formatted = numPrice % 1 === 0
        ? numPrice.toLocaleString('en-US')
        : numPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      priceHtml = `<p style="font-weight:800;font-size:1.6rem;color:${badge.color};margin:0.5rem 0;">$${formatted}</p>`;
    }
  }

  const featureBullets = features.map((f, i) =>
    i === 0
      ? `<li>✅ <strong>${f}</strong></li>`
      : `<li>✅ ${f}</li>`
  ).join("\n");

  return `<div class="gtd-product-card" style="border-color:${badge.color};">
<span class="gtd-badge" style="background:${badge.color};align-self:flex-start;margin-bottom:1rem;">${badge.label}</span>
${imageHtml}
<h3>${product.title}</h3>
${priceHtml}
<ul>
${featureBullets}
</ul>
<div style="margin-top:auto;"><a class="gtd-cta" href="${productUrl}">View ${shortName}</a></div>
</div>`;
}

export function buildFeaturedProductsSection(
  products: {
    title: string;
    description?: string;
    price?: string;
    imageUrl?: string;
    url?: string;
    handle?: string;
    vendor?: string;
    tags?: string;
    bullets?: string[];
  }[],
  categoryLabel: string
): string {
  const displayProducts = products.slice(0, 4);
  const cards = displayProducts.map((p, i) => buildProductCard(p, i, displayProducts)).join("\n");
  return `<section id="featured-products" class="gtd-section">
<h2 class="gtd-center">Top ${categoryLabel} Picks</h2>
<p style="margin-bottom:3rem;color:#666;font-size:1.6rem;" class="gtd-center">Premium quality with pre-delivery inspection and expert support.</p>
<div class="gtd-grid cols-${Math.min(displayProducts.length, 2)}">
${cards}
</div>
</section>`;
}
