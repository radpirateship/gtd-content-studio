// Article content generation route — PPW Style Guide compliant
// Generates full PPW-templated articles with navigation, products, FAQ, schema
import { type NextRequest, NextResponse } from "next/server";
import { type WellnessCategory } from "@/lib/types";
import { callAI, looksLikeReasoning } from "@/lib/ai";
import { repairBodyBlocks } from "@/lib/body-repair";
import { isExcludedVendor, liftedVendors } from "@/lib/product-exclusions";
import { WRITING_RULES, validateBrandRules, stripEmDashes, scrubUncarriedBrands, scrubSeoJargon } from "@/lib/brandRules";
import { CATEGORY_TO_COLLECTION } from "@/lib/collections";
import { asHub } from "@/lib/collection-category";
import { PPW_STYLES } from "@/lib/ppw-template";
import {
  V2_BODY_SPEC, V2_FAQ_SPEC, V2_ANSWER_SPEC, V2_TAKEAWAYS_SPEC,
  buildV2Header, buildV2Answer, buildV2Takeaways, buildV2Toc, buildV2Picks, buildV2GuideLink,
  buildV2Faq, buildV2ShopCta, buildV2Author, buildV2Related, buildV2Document,
  pickAuthor, esc as escV2, auditV2Links, sealTruncatedBody,
  buildV2LinkBrief, buildLinkInventory, sealV2Links, dedupeV2Links, splitAdjacentLinks, linkKey, auditAnchorText,
  capCollectionLinks, fillCollectionLinks, buildV2ProductBrief, buildV2CatalogueResearch, parseJsonArrayTolerant, linkComparisonTable,
  closeUnclosedBlocks, capComparisonRows, dropEmptyComparisonColumns,
} from "@/lib/article-v2";
import { MASTER_COLLECTIONS, COLLECTION_AFFINITY } from "@/lib/collections";
import { listPublishedArticlePaths } from "@/lib/shopify/blog-admin";
import { listLiveCollectionHandles, fetchAdminProducts } from "@/lib/shopify/products-admin";
import { specsFromDescription } from "@/lib/product-specs";
import { CATEGORY_LABELS } from "@/lib/types";
import { getSQL } from "@/lib/db";

// Body + FAQ AI calls (each up to 90s, retried) — give the function room so
// Vercel doesn't kill it mid-retry on long articles.
export const maxDuration = 300;

// ============================================================================
// PPW STYLE BLOCK — Embedded in every article for Shopify compatibility
// ============================================================================
// PPW_STYLES lives in lib/ppw-template.ts and is FROZEN, legacy only. It was
// duplicated here; now imported so there is one copy. See the notice there.

// ============================================================================
// SVG icon for external links
// ============================================================================
const LINK_SVG = '<svg stroke-linejoin="round" stroke-linecap="round" stroke-width="2" stroke="currentColor" fill="none" viewBox="0 0 24 24" height="16" width="16" xmlns="http://www.w3.org/2000/svg"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>';

// ============================================================================
// Category collection slugs (maps category to Shopify collection handle)
// ============================================================================

// Derived from MASTER_COLLECTIONS, which is the single source of truth. This
// used to be a hand-copied map that stopped at pilates: hot tubs, compression
// boots, every massager, EMF, rowing, the whole home gym range and all sports
// were missing, so their shop CTA fell through to /collections/all.
const CATEGORY_COLLECTION: Record<string, string> = CATEGORY_TO_COLLECTION;

// ============================================================================
// Category → Ultimate Guide mapping (title + URL for each collection's pillar)
// ============================================================================

const CATEGORY_ULTIMATE_GUIDE: Record<string, { title: string; url: string }> = {
  // Saunas
  saunas: { title: "The Ultimate Guide to Saunas", url: "/pages/ultimate-guide-to-saunas" },
  "barrel-saunas": { title: "The Ultimate Guide to Barrel Saunas", url: "/pages/barrel-saunas-ultimate-guide" },
  "infrared-saunas": { title: "The Ultimate Guide to Infrared Saunas", url: "/pages/infrared-saunas-ultimate-guide" },
  "outdoor-saunas": { title: "The Ultimate Guide to Outdoor Saunas", url: "/pages/outdoor-saunas-ultimate-guide" },
  "traditional-saunas": { title: "The Ultimate Guide to Traditional Saunas", url: "/pages/the-ultimate-guide-to-traditional-saunas" },
  "hybrid-saunas": { title: "Hybrid Sauna Ultimate Guide", url: "/pages/hybrid-saunas-ultimate-guide" },
  "sauna-heaters": { title: "The Ultimate Guide to Sauna Heaters", url: "/pages/ultimate-guide-to-sauna-heaters" },
  steam: { title: "The Ultimate Guide to Steam Showers", url: "/pages/ultimate-guide-to-steam-shower-generators" },
  // Recovery
  "cold-plunges": { title: "The Ultimate Guide to Cold Plunges", url: "/pages/cold-plunge-ultimate-guide" },
  "red-light-therapy": { title: "The Ultimate Guide to Red Light Therapy", url: "/pages/red-light-therapy-ultimate-guide" },
  "hyperbaric-chambers": { title: "The Ultimate Guide to Hyperbaric Chambers", url: "/pages/hyperbaric-chambers-ultimate-guide" },
  "massage-equipment": { title: "The Ultimate Guide to Massage Equipment", url: "/pages/massage-equipment-ultimate-guide" },
  "compression-boots": { title: "The Ultimate Guide to Compression Boots", url: "/pages/compression-boots-ultimate-guide" },
  "sensory-deprivation-tanks": { title: "The Ultimate Guide to Sensory Deprivation Tanks", url: "/pages/sensory-deprivation-tanks-ultimate-guide" },
  "hot-tubs": { title: "The Ultimate Guide to Hot Tubs", url: "/pages/hot-tubs-ultimate-guide" },
  // Wellness
  "hydrogen-water": { title: "The Ultimate Guide to Hydrogen Water", url: "/pages/hydrogen-water-ultimate-guide" },
  "water-ionizers": { title: "The Ultimate Guide to Water Ionizers", url: "/pages/water-ionizers-ultimate-guide" },
  "air-purifiers": { title: "The Ultimate Guide to Air Purifiers", url: "/pages/air-purifiers-ultimate-guide" },
  // Fitness
  "elliptical-machines": { title: "The Ultimate Guide to Elliptical Machines", url: "/pages/elliptical-machines-ultimate-guide" },
  "exercise-bikes": { title: "The Ultimate Guide to Exercise Bikes", url: "/pages/exercise-bikes-ultimate-guide" },
  treadmills: { title: "The Ultimate Guide to Treadmills", url: "/pages/treadmills-ultimate-guide" },
  "stair-climbers": { title: "The Ultimate Guide to Stair Climber Machines", url: "/pages/stair-climber-machines-ultimate-guide" },
  "vertical-climbers": { title: "The Ultimate Guide to VersaClimber Machines", url: "/pages/vertical-climbers-ultimate-guide" },
  pilates: { title: "The Ultimate Guide to Pilates Equipment", url: "/pages/pilates-ultimate-guide" },
  "sauna-accessories": { title: "The Ultimate Guide to Sauna Accessories", url: "/pages/sauna-accessories-ultimate-guide" },
  "sauna-kits": { title: "The Ultimate Guide To Sauna Kits", url: "/pages/sauna-kits-ultimate-guide" },
  // Wellness
  "emf-protection": { title: "The Ultimate Guide to EMF Protection", url: "/pages/emf-protection-ultimate-guide" },
  // Sports
  "lacrosse-equipment": { title: "The Ultimate Guide to Lacrosse Equipment", url: "/pages/lacrosse-training-ultimate-guide" },
  "pickleball-paddles": { title: "The Ultimate Guide to Pickleball Paddles", url: "/pages/pickleball-paddle-ultimate-guide" },
  "reaction-training": { title: "The Ultimate Guide to Reaction Training", url: "/pages/reaction-time-training-ultimate-guide" },
  "timing-systems": { title: "The Ultimate Guide to Athletic Timing Systems", url: "/pages/timing-systems-ultimate-guide" },
  // NOTE: neck-training, home gym collections — no ultimate guides yet
};

// Derive a collection slug from a human-readable collection name (fallback)
function collectionNameToSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

// ============================================================================
// HELPER: Badge config for product cards (assigned by price ranking)
// ============================================================================
const BADGE_CHEAPEST   = { label: "Great Starting Point", color: "#16a34a" };
const BADGE_TOP_PICK   = { label: "Top Pick",         color: "#dc2626" };
const BADGE_PREMIUM    = { label: "Premium Choice",   color: "#9333ea" };
const BADGE_COMMERCIAL = { label: "Commercial Grade",  color: "#ea580c" };

/**
 * Assign badges based on price ranking so "Best Value" goes to the cheapest
 * product and "Commercial Grade" goes to the most expensive.
 */
function assignBadge(products: { price?: string }[], index: number): { label: string; color: string } {
  if (products.length <= 1) return BADGE_TOP_PICK;
  
  // Sort indices by price ascending
  const priceRanked = products
    .map((p, i) => ({ i, price: parseFloat(p.price || '0') || 0 }))
    .sort((a, b) => a.price - b.price);
  
  const rank = priceRanked.findIndex(r => r.i === index);
  const total = priceRanked.length;

  // Assign badges by relative rank — no absolute price thresholds
  // so high-ticket categories (float tanks, saunas, hyperbaric) get meaningful badges too
  if (rank === 0) return BADGE_CHEAPEST;
  if (rank === total - 1) return BADGE_COMMERCIAL;
  if (rank === 1) return BADGE_TOP_PICK;
  return BADGE_PREMIUM;
}

// ============================================================================
// HELPER: Extract short product name for CTA button
// ============================================================================
function getShortName(title: string): string {
  const cleaned = title
    .replace(/^(dynamic|maxxus|golden designs|sun home|medical breakthrough|therasage|echo|tyent|life)\s+/i, '')
    .replace(/\s+(low emf|far ir|infrared|sauna|cold plunge|red light|therapy)\s*$/i, '')
    .trim();
  const words = cleaned.split(/\s+/).slice(0, 3);
  return words.join(' ') || title.split(/\s+/).slice(0, 2).join(' ');
}

// ============================================================================
// HELPER: Extract feature bullets from product data
// ============================================================================
function extractFeatures(product: {
  title: string;
  description?: string;
  tags?: string;
  vendor?: string;
}): string[] {
  const features: string[] = [];
  const desc = (product.description || '').toLowerCase();
  const tags = (product.tags || '').toLowerCase();
  const title = (product.title || '').toLowerCase();

  const featureMap: [RegExp, string][] = [
    [/low[\s-]?emf/i, 'Low EMF Certified'],
    [/full[\s-]?spectrum/i, 'Full Spectrum Heating'],
    [/ultra[\s-]?low[\s-]?emf/i, 'Ultra-Low EMF Technology'],
    [/chromotherapy|chromo[\s-]?therapy/i, 'Chromotherapy Lighting'],
    [/speaker|built[\s-]?in[\s-]?audio|sound[\s-]?system|premium[\s-]?audio/i, 'Built-In Audio System'],
    [/bluetooth/i, 'Bluetooth Connectivity'],
    [/carbon[\s-]?heat/i, 'Carbon Heating Panels'],
    [/ceramic[\s-]?heat/i, 'Ceramic Heaters'],
    [/canadian[\s-]?(red\s)?cedar/i, 'Canadian Cedar Construction'],
    [/hemlock/i, 'Hemlock Wood Construction'],
    [/dual[\s-]?wall/i, 'Premium Dual-Wall Build'],
    [/stainless[\s-]?steel/i, 'Stainless Steel Construction'],
    [/insulated/i, 'Enhanced Insulation'],
    [/wifi|wi-fi|app[\s-]?control/i, 'WiFi & App Control'],
    [/touch[\s-]?screen|touchscreen/i, 'Touchscreen Controls'],
    [/corner[\s-]?design/i, 'Space-Saving Corner Design'],
    [/outdoor/i, 'Outdoor-Rated Design'],
    [/barrel/i, 'Classic Barrel Design'],
    [/\b(\d+)[\s-]?person/i, '$1-Person Capacity'],
    [/portable/i, 'Portable Design'],
    [/foldable|fold[\s-]?up/i, 'Foldable for Easy Storage'],
    [/\bchiller\b|active[\s-]?cooling|cooling[\s-]?system/i, 'Active Cooling System'],
    [/ozone[\s-]?(?:generator|sanit)|uv[\s-]?ozone/i, 'Ozone Sanitization'],
    [/(\d+)[\s-]?micron/i, '$1-Micron Filtration'],
    [/multi[\s-]?stage[\s-]?filtration|dual[\s-]?stage[\s-]?filtration/i, 'Multi-Stage Filtration'],
    [/hydrogen[\s-]?rich/i, 'Hydrogen-Rich Water'],
    [/alkaline/i, 'Alkaline Water System'],
    [/red[\s-]?light|led[\s-]?panel/i, 'Medical-Grade LEDs'],
    [/(\d+)\s*(?:nm|nanometer)/i, 'Targeted Wavelength Therapy'],
    [/fiberglass|gel[\s-]?coat/i, 'Fiberglass Shell Construction'],
    [/salt|magnesium/i, 'Epsom Salt / Magnesium Water'],
    [/soundproof|acoustic/i, 'Soundproofed Float Environment'],
    [/easy[\s-]?(?:access|entry)|hinged[\s-]?lid|gas[\s-]?strut|wide[\s-]?(?:door|opening)|step[\s-]?in/i, 'Easy-Access Entry Design'],
    [/commercial[\s-]?grade|commercial use/i, 'Commercial-Grade Build'],
    [/uv[\s-]?sanitiz|uv light/i, 'UV Sanitization System'],
    [/fully[\s-]?enclosed|enclosed[\s-]?(?:pod|cabin|design)/i, 'Fully Enclosed Design'],
    [/open[\s-]?pool|open float/i, 'Open Pool Design'],
    // Was /1000 lb|large capacity/ -> 'Large-Capacity Float Pool', a float
    // tank pattern so broad it matched any product rated 1,000 lb: a weight
    // bench card shipped with a float pool chip. Require float context.
    [/large[\s-]?capacity[\s-]?(?:float|pool)|float[\s-]?pool|float[\s-]?tank/i, 'Large-Capacity Float Pool'],
    // Strength capacity: "1,000 lb capacity" / "rated to 700 lbs".
    [/\b([\d,]{3,5})\s*(?:lb|lbs|pound)s?\s*(?:weight[\s-]?)?(?:capacity|rating|rated)/i, '$1 lb Capacity'],
    [/rated\s*(?:to|at)\s*([\d,]{3,5})\s*(?:lb|lbs)/i, '$1 lb Capacity'],
    [/\b(\d{1,2})[\s-]?(?:back(?:rest)?[\s-]?)?positions?\b/i, '$1 Adjustment Positions'],
    [/\b(\d{3,4})\s*(?:gallon|gal)\b/i, '$1-Gallon Water Capacity'],
    [/(\d\.\d)\s*ata/i, '$1 ATA Pressure'],
    [/1\.3|1\.5|2\.0\s*ata/i, 'Multi-Pressure ATA Settings'],
    [/steam[\s-]?generator|steam[\s-]?shower/i, 'Integrated Steam Generator'],
    [/touchscreen|digital[\s-]?control/i, 'Digital Control Panel'],
    [/eucalyptus|aromatherapy/i, 'Aromatherapy Compatible'],
    [/\b([1-9]\d?(?:\.\d)?)[\s-]?kw\b/i, '$1kW Power Output'],
    // Cardio and strength. The map previously had no entries for these, so
    // rower, treadmill, bike and elliptical round-ups matched nothing and
    // every card fell through to generic filler bullets. Added Aug 3 2026.
    [/water[\s-]?(?:flywheel|resistance|rowing)|water[\s-]?tank/i, 'Water Resistance Flywheel'],
    [/air[\s-]?resistance|air[\s-]?flywheel|damper[\s-]?setting/i, 'Air Resistance Flywheel'],
    [/magnetic[\s-]?resistance/i, 'Magnetic Resistance'],
    [/pm5|pm4|performance[\s-]?monitor|console[\s-]?display/i, 'Performance Monitor Console'],
    [/solid[\s-]?(?:ash|oak|cherry|walnut|hardwood)|hardwood[\s-]?frame/i, 'Solid Hardwood Frame'],
    [/upright[\s-]?storage|stores?[\s-]?upright|vertical[\s-]?storage/i, 'Stores Upright'],
    // Was \b(\d{3}), which grabbed the "000" out of "1,000 lb user weight" and
    // shipped "000 lb User Capacity". Capture the whole number, commas included.
    [/\b([\d,]{3,5})\s*lb(?:s)?\s*(?:user|weight|max)/i, '$1 lb User Capacity'],
    [/incline/i, 'Adjustable Incline'],
    [/cushioned[\s-]?deck|running[\s-]?deck|shock[\s-]?absorb/i, 'Cushioned Running Deck'],
    [/heart[\s-]?rate|hr[\s-]?monitor|pulse[\s-]?sensor/i, 'Heart Rate Monitoring'],
    [/resistance[\s-]?levels?|\b(\d{1,2})[\s-]?resistance/i, 'Multiple Resistance Levels'],
    // Strength and general build specs. Added Aug 29 2026: cards were falling
    // through to service filler because the map barely covered racks, benches,
    // barbells and plates.
    [/\b(\d{1,2})[\s-]?gauge\s*steel/i, '$1-Gauge Steel Frame'],
    [/powder[\s-]?coat/i, 'Powder-Coated Finish'],
    [/\b([\d,]{3,5})\s*lb(?:s)?\s*(?:weight[\s-]?)?stack/i, '$1 lb Weight Stack'],
    [/olympic\s*(?:size|2[\s-]?inch|sleeve)/i, 'Olympic 2-Inch Sleeves'],
    [/knurl/i, 'Knurled Grip'],
    [/\b(\d{2,3})[\s-]?(?:kg|kilo)/i, '$1 kg Rated'],
    [/lifetime\s*warranty/i, 'Lifetime Warranty'],
    [/\b(\d{1,2})[\s-]?year\s*warranty/i, '$1-Year Warranty'],
    [/\b(\d(?:\.\d)?)\s*(?:hp|horsepower)/i, '$1 HP Motor'],
    [/\b(\d{1,2}(?:\.\d)?)\s*mph/i, 'Up to $1 MPH'],
    [/urethane|rubber[\s-]?coated|bumper[\s-]?plate/i, 'Rubber-Coated Plates'],
    [/\b(\d{2,3})\s*(?:in|inch|")\s*(?:x|by)\s*(\d{2,3})/i, 'Compact $1 by $2 Inch Footprint'],
    [/transport[\s-]?wheels?|wheels?\s*for\s*(?:easy\s*)?(?:moving|transport)/i, 'Built-In Transport Wheels'],
    [/non[\s-]?slip|textured[\s-]?(?:grip|surface)/i, 'Non-Slip Surface'],
    [/adjustable[\s-]?height|height[\s-]?adjust/i, 'Adjustable Height'],
  ];

  const combined = `${title} ${desc} ${tags}`;
  for (const [pattern, label] of featureMap) {
    if (pattern.test(combined) && features.length < 3) {
      const match = combined.match(pattern);
      if (label.includes('$1') && match?.[1]) {
        features.push(label.replace('$1', match[1]));
      } else if (!features.includes(label)) {
        features.push(label);
      }
    }
  }

  // Bullets sell the PRODUCT, not the service. "Stainless steel construction"
  // and "250 lb user capacity" tell a buyer something; "Ongoing US-Based Phone
  // Support" is on every card of every article and tells them nothing.
  //
  // Old behaviour appended the service line unconditionally and capped real
  // specs at 2, so a card with three good specs still gave one slot away, and
  // a card with none showed two filler lines and nothing else.
  //
  // Now: up to 3 product specs, and the generic lines fill ONLY the gap the
  // product data could not. Two real specs means no filler at all.
  // The vendor's own bullet list beats anything we can synthesise, and it is
  // their words rather than ours: "3C to 38C control range", "330 lbs weight
  // capacity", "Canadian cedar exterior housing". Roughly half of PPW products
  // carry such a list. Whatever it cannot supply, the keyword map above fills.
  const fromDescription = specsFromDescription(product.description, 3);
  const seen = new Set(fromDescription.map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, "")));
  const specs = [...fromDescription];
  for (const f of features) {
    if (specs.length >= 3) break;
    const key = f.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    specs.push(f);
  }

  // Never "free shipping" (conditional on product class and not offered on
  // freight items such as saunas) and never a white-glove or assembly promise,
  // neither of which PPW offers. A card showing filler means the Shopify
  // description is thin; /product-bullets surfaces those for a manual spec.
  const FALLBACKS = ['Quality Inspected Before Shipping', 'Ongoing US-Based Phone Support'];
  while (specs.length < 2 && FALLBACKS.length) specs.push(FALLBACKS.shift() as string);

  return specs.slice(0, 3);
}

// ============================================================================
// HELPER: Build PPW product card HTML (matches Costco article style)
// ============================================================================
function buildProductCard(product: {
  title: string;
  description?: string;
  price?: string;
  imageUrl?: string;
  url?: string;
  handle?: string;
  vendor?: string;
  tags?: string;
}, index: number, allProducts: { price?: string }[]): string {
  const badge = assignBadge(allProducts, index);
  // Use relative Shopify product URLs for internal linking
  const productUrl = product.handle ? `/products/${product.handle}` : (product.url || "#");
  const shortName = getShortName(product.title);
  const features = extractFeatures(product);

  const imageHtml = product.imageUrl
    ? `<div class="ppw-product-image-container"><img src="${product.imageUrl}" alt="${product.title}" class="ppw-product-image" loading="lazy" /></div>`
    : "";

  // Format price with commas and clean trailing decimals
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

  // First feature gets bolded (the lead product-specific feature)
  const featureBullets = features.map((f, i) =>
    i === 0
      ? `<li>\u2705 <strong>${f}</strong></li>`
      : `<li>\u2705 ${f}</li>`
  ).join("\n");

  return `<div class="ppw-product-card" style="border-color:${badge.color};">
<span class="ppw-badge" style="background:${badge.color};align-self:flex-start;margin-bottom:1rem;">${badge.label}</span>
${imageHtml}
<h3>${product.title}</h3>
${priceHtml}
<ul>
${featureBullets}
</ul>
<div style="margin-top:auto;"><a class="ppw-cta" href="${productUrl}">View ${shortName}</a></div>
</div>`;
}

// ============================================================================
// HELPER: Build related articles footer
// ============================================================================
function buildRelatedArticlesHtml(articles: { title: string; url: string; description: string }[]): string {
  if (!articles || articles.length === 0) return "";
  const displayArticles = articles.slice(0, 3);
  const cards = displayArticles.map((a) =>
    `<article class="ppw-card">
<h3 class="ppw-card-title"><a href="${a.url}" class="ppw-links">${a.title}</a></h3>
<p class="ppw-sm">${a.description}</p>
</article>`
  ).join("\n");

  return `<section class="ppw-section">
<h2>Continue Your Wellness Journey</h2>
<div class="ppw-grid cols-3">
${cards}
</div>
</section>`;
}

// ============================================================================
// MAIN ROUTE HANDLER
// ============================================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, keyword, category, tone, wordCount, products, relatedArticles,
      articleType, audience, collection, specialInstructions, includeComparisonTable,
      internalLinks } = body;

    // template_version 2 is the ppwb- design system in the ppw-blog.css theme
    // asset. Version 1 is the frozen legacy path with its inline <style> block.
    // Default to 2 for new articles; send templateVersion: 1 to force legacy.
    const useV2 = Number(body.templateVersion ?? 2) === 2;

    if (!title || !keyword) {
      return NextResponse.json({ error: "Title and keyword are required" }, { status: 400 });
    }

    const targetWordCount = wordCount || 2500;
    const articleTone = tone || "educational";
    let categoryLabel = CATEGORY_LABELS[category as WellnessCategory] || category || "Wellness";
    // The brain stores a live Shopify handle in collection_slug, and 33 of the
    // handles it uses are not app slugs (home-gym-equipment, cardio-machines,
    // walkingpad, brand collections). Falling straight to the label de-slugged
    // "Home Gym Equipment for Every Workout" into a handle that 404s. Trust the
    // stored slug before guessing from the label.
    let collectionSlug = CATEGORY_COLLECTION[category] || category || (collection ? collectionNameToSlug(collection) : "all");
  const readTime = Math.max(5, Math.round(targetWordCount / 250));
  
    // Map article type to structural guidance
    const ARTICLE_TYPE_INSTRUCTIONS: Record<string, string> = {
      'buyers-guide': 'Structure as a Buyer\'s Guide: Start with what to look for, include selection criteria, compare options, and end with clear recommendations. Use a "What to Look For" section early.',
      'comparison': 'Structure as a Comparison article: Present multiple options side-by-side. Include a comparison table if appropriate. Highlight pros/cons of each option objectively.',
      'how-to': 'Structure as a How-To Guide: Use numbered steps, be highly practical and actionable. Include a "What You\'ll Need" section and step-by-step instructions.',
      'listicle': 'Structure as a Listicle: Use numbered items as H2 headings. Each item gets its own section with 2-3 paragraphs of detail. Start with the strongest items.',
      'benefit-deep-dive': 'Structure as a Benefit Deep-Dive: Focus on a single benefit or health claim. Back it up with research, mechanisms of action, and real-world application.',
      'brand-review': 'Structure as a Brand Review: Cover the brand\'s history, product range, build quality, pricing, customer experience, and who it\'s best for. Be balanced and honest.',
      'ultimate-guide': 'Structure as an Ultimate Guide: This should be the most comprehensive resource on the topic. Cover every major subtopic, include a table of contents, and aim for depth over breadth in each section.',
    };

    const AUDIENCE_INSTRUCTIONS: Record<string, string> = {
      'general': 'Write for a general wellness audience. Avoid jargon, explain technical concepts simply.',
      'enthusiast': 'Write for wellness enthusiasts who already understand basics. Use more technical language and reference specific protocols.',
      'athlete': 'Write for athletes and performance-focused readers. Emphasize performance benefits, recovery metrics, and training integration.',
      'first-time': 'Write for first-time buyers researching their first purchase. Address common concerns, explain what to expect, and emphasize value.',
      'professional': 'Write for health professionals and practitioners. Use clinical terminology, reference studies, and discuss mechanisms of action.',
    };

    const typeInstruction = ARTICLE_TYPE_INSTRUCTIONS[articleType || ''] || '';
    const audienceInstruction = AUDIENCE_INSTRUCTIONS[audience || ''] || AUDIENCE_INSTRUCTIONS['general'];
    const collectionContext = collection ? `This article is for the "${collection}" product collection on Peak Primal Wellness.` : '';
    const comparisonInstruction = includeComparisonTable ? '\n- Include a comparison table using PPW grid markup: <div class="ppw-grid cols-2"> or cols-3 with ppw-card items comparing key features, specs, or options. CRITICAL: You MUST close the </div> for ppw-grid and then close the </section> tag IMMEDIATELY after the last ppw-card. Do NOT leave any unclosed div or section tags — the FAQ is appended after your output and unclosed tags will swallow it. The comparison table must NOT be the last content section — follow it with at least one more short prose section before the article ends.' : '';
    const specialContext = specialInstructions ? `\nSPECIAL INSTRUCTIONS FROM EDITOR:\n${specialInstructions}` : '';

    // ==================================================================
    // AI PROMPT — Instructs Claude to output PPW-class-based HTML
    // ==================================================================
    // ── LINK INVENTORY ──────────────────────────────────────────────────────
    // The model cannot know a slug. Given a link budget and no list, it writes
    // slugs that look exactly right and 404 — that is how /blogs/wellness/
    // cold-plunge-setup-guide and /collections/cold-plunge (singular) shipped.
    // internalLinks comes from topical_authority, already scoped to this
    // article's collection; collections come from MASTER_COLLECTIONS, filtered
    // to the same hub so a sauna article cannot link to compression boots.
    let linkArticles: { title: string; url: string; planned?: boolean }[] = (internalLinks || [])
      .filter((l: { title?: string; url?: string }) => l?.title && l?.url)
      .map((l: { title: string; url: string; planned?: boolean }) => ({ title: l.title, url: l.url, planned: !!l.planned }));
    const plannedCount = linkArticles.filter((l) => l.planned).length;

    // The inventory itself is not trustworthy. topical_authority holds URLs typed
    // into a CSV, and content_brain builds them from url_slug for any row marked
    // 'live' or 'published', whether or not the article ever shipped under that
    // slug. Shopify is the only authority on what is actually live, so filter
    // against it. On failure the set comes back empty and the filter is skipped,
    // because losing every internal link is worse than risking a stale one.
    // relatedArticles feeds the "Keep reading" tiles and comes from the same
    // unvalidated tables, so it needs the same filter. Validating only the body
    // inventory left /blogs/wellness/tips-for-beginners-using-cold-plunges, a
    // 404, sitting in the tiles of a published article.
    let relatedForV2: { title: string; url: string; description: string }[] = relatedArticles || [];
    try {
      const publishedPaths = await listPublishedArticlePaths();
      if (publishedPaths.size) {
        const dropped: string[] = [];
        // A link flagged planned is an article in the same batch, not yet
        // published. It is kept on purpose: the batch publishes together under
        // these slugs, which is how cluster interlinking is meant to work.
        // This applies to the TILES as well as the body (Ryan, 8 Sept 2026).
        // Excluding planned links from the tiles meant a brand-new cluster had
        // no siblings to show, and the widening below then reached outside the
        // topic entirely: every dynamometer draft in the 8 Sept run carried the
        // same three sauna-heaters tiles. A batch links to itself.
        const keep = <T extends { url: string; planned?: boolean; cluster?: boolean }>(l: T) => {
          // Planned, or from this article's own cluster. Both are the batch.
          if (l.planned || l.cluster) return true;
          const live = publishedPaths.has(linkKey(l.url));
          if (!live) dropped.push(l.url);
          return live;
        };
        const beforeBody = linkArticles.length;
        const beforeRelated = relatedForV2.length;
        linkArticles = linkArticles.filter(keep);
        relatedForV2 = relatedForV2.filter((r) => keep({ ...r, planned: false }));
        if (plannedCount) console.log(`[v0] Generate: ${plannedCount} planned cluster link(s) kept in the body inventory`);
        if (dropped.length) {
          console.warn(
            `[v0] Generate: dropped ${dropped.length} URL(s) not published in Shopify ` +
            `(body inventory ${beforeBody}->${linkArticles.length}, related ${beforeRelated}->${relatedForV2.length}): ${dropped.join(", ")}`,
          );
        }

        // Top the tiles back up. The client only ever sends three related
        // articles, so dropping one dead URL leaves a two-tile row with a gap.
        // linkArticles is the same topic cluster and has already been validated,
        // so refill from there rather than shipping a short row.
        if (relatedForV2.length < 3) {
          const have = new Set(relatedForV2.map((r) => linkKey(r.url)));
          // Live siblings first, then the rest of this batch. Both are the
          // article's own cluster; the live ones are simply the safer half.
          const isLive = (c: { planned?: boolean; url: string }) => !c.planned && publishedPaths.has(linkKey(c.url));
          for (const cand of [...linkArticles.filter(isLive), ...linkArticles.filter((c) => !isLive(c))]) {
            if (relatedForV2.length >= 3) break;
            const k = linkKey(cand.url);
            if (have.has(k)) continue;
            have.add(k);
            relatedForV2.push({ title: cand.title, url: cand.url, description: "" });
          }
          console.log(`[v0] Generate: related tiles topped up to ${relatedForV2.length}`);
        }

        // A brand-new cluster has few or no live siblings, so the cluster
        // refill above can still leave one or two tiles. Widen once: live
        // articles from topical_authority anywhere on the site, same
        // collection first, validated against the published set.
        if (relatedForV2.length < 3) {
          try {
            const sql = getSQL();
            // Same hub only. This query used to be genuinely site-wide, with
            // the collection merely sorted first: on a brand-new cluster with
            // no published siblings the sort matched nothing and it handed
            // back whatever was newest in the table. Every dynamometer draft
            // in the 8 Sept run got the same three sauna-heaters articles as
            // its Keep reading tiles. Related now means related.
            const own = MASTER_COLLECTIONS.find(
              (c) => c.slug === collectionSlug || c.shopifyHandle === collectionSlug,
            );
            const near = new Set<string>([collectionSlug]);
            for (const h of COLLECTION_AFFINITY[own?.shopifyHandle ?? collectionSlug] || []) near.add(h);
            if (own) {
              for (const c of MASTER_COLLECTIONS) if (c.hub === own.hub) { near.add(c.slug); near.add(c.shopifyHandle); }
            }
            const nearList = Array.from(near).filter(Boolean);
            const rows = (await sql`
              SELECT title, existing_url, meta_description, collection_slug
              FROM topical_authority
              WHERE existing_url IS NOT NULL AND existing_url != ''
                AND collection_slug = ANY(${nearList}::text[])
              ORDER BY (collection_slug = ${collectionSlug}) DESC, id DESC
              LIMIT 200
            `) as { title: string; existing_url: string; meta_description?: string }[];
            // A collection the app does not know has no hub, so nearList is
            // just itself and this returns nothing. Two tiles, or none, beats
            // three tiles about another category.
            const have = new Set(relatedForV2.map((r) => linkKey(r.url)));
            const selfKey = linkKey(`/blogs/wellness/${String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
            for (const row of rows) {
              if (relatedForV2.length >= 3) break;
              const k = linkKey(row.existing_url);
              if (!k.startsWith("/blogs/") || have.has(k) || k === selfKey) continue;
              if (!publishedPaths.has(k)) continue;
              if (/ultimate guide/i.test(row.title || "")) continue;
              have.add(k);
              relatedForV2.push({ title: row.title, url: row.existing_url, description: row.meta_description || "" });
            }
            console.log(`[v0] Generate: related tiles site-wide fallback -> ${relatedForV2.length}`);
          } catch (e) {
            console.warn("[v0] Generate: related tiles fallback query failed", e instanceof Error ? e.message : e);
          }
        }
      } else {
        console.warn("[v0] Generate: Shopify returned no published article paths, skipping inventory validation");
      }
    } catch (e) {
      console.warn("[v0] Generate: could not validate link inventory against Shopify:", e instanceof Error ? e.message : e);
    }

    linkArticles = linkArticles.slice(0, 12);

    // The article's own collection. Ryan's standing instruction: the synced
    // collection hub (ppw_collections, refreshed from Shopify by
    // /api/collections/sync-shopify) is the authority, not the hand-typed
    // MASTER_COLLECTIONS array. The array is the last-resort fallback only,
    // for when the database is unreachable.
    let ownCollection: { slug: string; label: string; shopifyHandle: string; hub: string } | undefined;
    try {
      const sql = getSQL();
      const rows = await sql`
        SELECT slug, category, title_tag, primary_keyword
        FROM ppw_collections
        WHERE slug = ${category} OR slug = ${CATEGORY_COLLECTION[category] ?? category}
        LIMIT 1`;
      const row = Array.from(rows)[0] as { slug: string; category?: string | null; title_tag?: string | null; primary_keyword?: string | null } | undefined;
      if (row?.slug) {
        ownCollection = {
          slug: row.slug,
          shopifyHandle: row.slug,
          label: CATEGORY_LABELS[row.slug as WellnessCategory]
            || (row.title_tag || "").split(/[|\-–:]/)[0].trim()
            || row.slug.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
          hub: asHub(row.category) || MASTER_COLLECTIONS.find((m) => m.shopifyHandle === row.slug)?.hub || "",
        };
      }
    } catch (e) {
      console.warn("[v0] Generate: ppw_collections lookup for own collection failed:", e instanceof Error ? e.message : e);
    }
    if (!ownCollection) {
      const m = MASTER_COLLECTIONS.find((c) => c.slug === category || c.shopifyHandle === category);
      if (m) ownCollection = { slug: m.slug, label: m.label, shopifyHandle: m.shopifyHandle, hub: m.hub };
      console.warn(`[v0] Generate: own collection "${category}" not in ppw_collections, ${m ? "using MASTER_COLLECTIONS fallback" : "trying live Shopify title"}`);
    }
    if (!ownCollection && category) {
      // Last resort before shipping a raw slug as the kicker: the live
      // Shopify title. "home-gym-equipment-for-every-workout" went out as the
      // breadcrumb, kicker, picks heading and shop button on one article.
      try {
        const { handles, titles } = await listLiveCollectionHandles();
        const h = String(category).toLowerCase();
        if (handles.has(h)) ownCollection = { slug: h, shopifyHandle: h, label: titles.get(h) || h, hub: "" };
      } catch { /* fall through to the slug */ }
    }
    const articleHub = ownCollection?.hub || undefined;
    // The shop CTA and breadcrumb point at the resolved collection, so a
    // category the static map has never heard of still gets a real button.
    if (ownCollection?.shopifyHandle) collectionSlug = ownCollection.shopifyHandle;
    if (ownCollection?.label) categoryLabel = ownCollection.label;

    // GUARD: whatever we ended up with has to be a handle that actually exists
    // on the live store. The shop button, the breadcrumb and the collection
    // links all use it, so an invented handle is a 404 on every article.
    //
    // How it broke: when no lookup resolved, the fallback slugified the
    // collection's DISPLAY NAME. The live title of `home-gym-equipment` is
    // "Home Gym Equipment for Every Workout", which slugified to
    // /collections/home-gym-equipment-for-every-workout on every article in
    // that collection. `general-wellness`, a retired catch-all, is the same
    // class of fault.
    //
    // Repair order: trim a marketing tail ("...-for-every-workout"), then trim
    // trailing segments one at a time, then fall back to /collections/all,
    // which always exists. Never ship an unverified handle.
    try {
      const { handles: liveHandles } = await listLiveCollectionHandles();
      const current = String(collectionSlug || "").toLowerCase();
      if (liveHandles.size > 0 && current !== "all" && !liveHandles.has(current)) {
        const candidates: string[] = [];
        const tailTrimmed = current.replace(/-(for|with|to|that|and|in)-.*$/, "");
        if (tailTrimmed && tailTrimmed !== current) candidates.push(tailTrimmed);
        const parts = current.split("-");
        // Down to a single segment. Stopping at two could never reach a
        // one-word handle, so "Saunum Sauna Systems" tried saunum-sauna, gave
        // up, and shipped /collections/all while /collections/saunum existed.
        // Candidates are longest-first, so the most specific live match wins.
        for (let n = parts.length - 1; n >= 1; n--) candidates.push(parts.slice(0, n).join("-"));
        const repaired = candidates.find((c) => liveHandles.has(c));
        console.warn(
          `[v0] Generate: collection handle "${current}" is not live; using "${repaired || "all"}"`
        );
        collectionSlug = repaired || "all";
      }
    } catch (e) {
      // A failed lookup must not block generation: keep what we have.
      console.warn("[v0] Generate: live collection handle check failed:", e instanceof Error ? e.message : e);
    }
    // Shopify collection titles carry marketing tails ("Home Gym Equipment for
    // Every Workout"). The kicker can show the whole title; the picks headings
    // and the shop button want the noun: the part before " for ", " | ", ":"
    // or " - ". A raw slug is de-hyphenated and title-cased as a last resort.
    const shortLabel = (() => {
      const base = categoryLabel.includes("-") && !categoryLabel.includes(" ")
        ? categoryLabel.replace(/-/g, " ").replace(/\b\w/g, (m: string) => m.toUpperCase())
        : categoryLabel;
      const cut = base.split(/\s+\|\s+|:\s+|\s+-\s+|\s+for\s+|\s+to\s+/i)[0].trim();
      return cut.length >= 4 ? cut : base;
    })();
    categoryLabel = shortLabel;

    // Order matters more than it looks. This used to be hub-filtered then
    // .slice(0, 10), which on the Recovery hub handed the model Cold Plunges
    // followed by six massage variants, and cut off Compression Boots, Neck
    // Training and Hot Tubs entirely. Hot Tubs is the obvious second link for a
    // cold plunge article, because contrast therapy is the natural cross-shop,
    // and it was never on the list. Every article ended up linking massage
    // equipment as filler.
    //
    // Now: the article's own collection first, then siblings ranked by how much
    // their label overlaps the title and keyword, then the rest. No truncation —
    // a 13-line list costs nothing in a prompt.
    const topicWords = new Set(
      `${title} ${keyword}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3),
    );
    // Candidate collections come from the DATABASE, not just the hardcoded array.
    //
    // MASTER_COLLECTIONS is not the wrong list — collections_registry auto-syncs
    // FROM it on every request, so the array is upstream, not stale. But the
    // registry also holds collections added through the app that the array has
    // never heard of, and ppw_collections holds the keywords per collection,
    // which is far better relevance signal than matching label words.
    // The array stays as the fallback if either query fails.
    type Cand = { slug: string; label: string; handle: string; keywords: string; hub: string };
    let candidates: Cand[] = MASTER_COLLECTIONS.map((c) => ({
      slug: c.slug, label: c.label, handle: c.shopifyHandle, keywords: "", hub: c.hub,
    }));

    try {
      const sql = getSQL();
      // ppw_collections is the Collections tool's own table — the full catalogue,
      // roughly 271 rows, not the 54 hand-listed hubs in MASTER_COLLECTIONS.
      // It also carries the keywords each collection targets, which is far better
      // relevance signal than matching words in a label.
      const rows = await sql`
        SELECT slug, category, primary_keyword, secondary_keywords, title_tag, is_hidden
        FROM ppw_collections`;
      const live = (Array.from(rows) as {
        slug: string; category?: string | null; primary_keyword?: string | null;
        secondary_keywords?: unknown; title_tag?: string | null; is_hidden?: boolean | null;
      }[]).filter((r) => r.slug && !r.is_hidden);

      if (live.length) {
        candidates = live.map((r) => {
          const master = MASTER_COLLECTIONS.find((m) => m.slug === r.slug || m.shopifyHandle === r.slug);
          const sec = Array.isArray(r.secondary_keywords)
            ? r.secondary_keywords.join(" ")
            : typeof r.secondary_keywords === "string" ? r.secondary_keywords : "";
          return {
            slug: r.slug,
            // Prefer a curated label; the title tag is SEO copy, so only use its
            // first clause, and fall back to a de-slugged name.
            label: master?.label
              || (r.title_tag || "").split(/[|\-–:]/)[0].trim()
              || r.slug.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
            handle: r.slug,
            keywords: `${r.primary_keyword || ""} ${sec} ${r.category || ""}`.toLowerCase(),
            hub: asHub(r.category) || master?.hub || "",
          };
        });
        console.log(`[v0] Generate: ${candidates.length} collection candidates from ppw_collections (MASTER_COLLECTIONS has ${MASTER_COLLECTIONS.length})`);
      }
    } catch (e) {
      console.warn("[v0] Generate: ppw_collections query failed, using MASTER_COLLECTIONS:", e instanceof Error ? e.message : e);
    }

    // Shopify is the authority on which collection handles exist. Same treatment
    // the article inventory gets: filter against it, and skip the filter entirely
    // if the call fails rather than shipping an empty list.
    try {
      const { handles, titles } = await listLiveCollectionHandles();
      if (handles.size) {
        const before = candidates.length;
        const dropped: string[] = [];
        candidates = candidates.filter((c) => {
          const live = handles.has(c.handle.toLowerCase());
          if (!live) dropped.push(c.handle);
          return live;
        });
        // Prefer Shopify's own title over a de-slugged guess.
        candidates = candidates.map((c) => ({ ...c, label: titles.get(c.handle.toLowerCase()) || c.label }));
        if (dropped.length) {
          console.warn(
            `[v0] Generate: dropped ${dropped.length}/${before} collection candidate(s) with no live Shopify handle: ${dropped.slice(0, 20).join(", ")}`,
          );
        }
      } else {
        console.warn("[v0] Generate: Shopify returned no collection handles, skipping collection validation");
      }
    } catch (e) {
      console.warn("[v0] Generate: could not validate collection handles:", e instanceof Error ? e.message : e);
    }

    const ownHandle = ownCollection?.shopifyHandle;
    // Same hub, as the synced table sees it. With no hub, everything qualifies.
    const hubHandles = new Set(
      candidates.filter((c) => !articleHub || c.hub === articleHub).map((c) => c.handle),
    );
    // Affinity beats hub membership: sauna is the other half of contrast therapy
    // and sits in a different hub, so hub filtering alone would hide it.
    const affinity = COLLECTION_AFFINITY[ownHandle ?? ""] || [];

    const siblings = candidates
      .filter((c) => c.handle !== ownHandle)
      .filter((c) => affinity.includes(c.handle) || hubHandles.has(c.handle) || c.keywords);

    const affinityRank = (h: string) => { const i = affinity.indexOf(h); return i === -1 ? 999 : i; };
    const kwScore = (c: Cand) => {
      const hay = `${c.label} ${c.keywords}`.toLowerCase();
      let n = 0;
      for (const w of topicWords) if (hay.includes(w)) n++;
      return n;
    };
    siblings.sort((a, b) => {
      const ra = affinityRank(a.handle), rb = affinityRank(b.handle);
      if (ra !== rb) return ra - rb;
      return kwScore(b) - kwScore(a);
    });

    const own = ownCollection
      ? [{ title: ownCollection.label, url: `/collections/${ownCollection.shopifyHandle}` }]
      : [];
    // 271 candidates cannot all go in the prompt. Rank, then cap at 12: the
    // article's own collection, its affinity partners, and the best keyword
    // matches. Anything below that is noise the model would pick from at random.
    const linkCollections = [
      ...own,
      ...siblings.slice(0, 11).map((c) => ({ title: c.label, url: `/collections/${c.handle}` })),
    ];

    // The product cards show a vendor line when the product carries one. If the
    // products table was loaded from a CSV export without a Vendor column, every
    // card silently loses that line. Say so in the run rather than leaving it to
    // be noticed in the published article.
    if (products?.length) {
      const noVendor = (products as { title?: string; vendor?: string }[]).filter((p) => !p.vendor?.trim());
      if (noVendor.length) {
        console.warn(
          `[v0] Generate: ${noVendor.length}/${products.length} product(s) have no vendor, so their cards will show no brand line. ` +
          `Re-import the product catalogue from a Shopify export that includes the Vendor column. Affected: ` +
          noVendor.map((p) => p.title?.slice(0, 40)).join(" | "),
        );
      }
    }

    // Brands the article is allowed to name: the vendors in its own product data
    // plus anything the editor put in the title or brief (a brand review names
    // its subject in the title). Everything else in a "brands like X" clause is
    // a competitor plug, whatever the category.
    // Model names count too: "Golden Designs Arosa" and "Klosters" were flagged
    // as rival brands because only vendors were listed. Titles of the featured
    // products and of the whole collection pool make every model PPW sells a
    // known name.
    const knownVendors: string[] = [
      ...((products || []) as { vendor?: string; title?: string }[]).flatMap((p) => [p.vendor || "", p.title || ""]).filter(Boolean),
      String(title || ""),
      String(keyword || ""),
      String(specialInstructions || ""),
      String(collection || ""),
      categoryLabel,
    ];

    const linkInventory = buildLinkInventory(linkArticles, linkCollections);
    const linkTitles = new Map<string, string>(
      [...linkArticles, ...linkCollections].map((x) => [linkKey(x.url), x.title]),
    );
    const linkBrief = buildV2LinkBrief(linkArticles, linkCollections);
    const productBrief = buildV2ProductBrief(products || []);

    // Catalogue research: read the whole collection's listings, not just the
    // four cards, and pull the passages that bear on this article's topic.
    // Live from Shopify; a failure just means the section is omitted.
    let catalogueResearch = "";
    let catalogPool: { title?: string; handle?: string; imageUrl?: string; vendor?: string }[] = [];
    if (useV2) {
      try {
        const handle = ownCollection?.shopifyHandle || collectionSlug;
        let pool = handle && handle !== "all" ? await fetchAdminProducts({ collectionHandle: handle, limit: 250 }) : [];
        // Banned vendors stay out of the research pass too, or the writer
        // quotes their listings in prose while the cards show other brands.
        // If the editor featured one deliberately (targetBrand), keep them.
        const lifted = liftedVendors({ title, keyword, collection: collectionSlug, instructions: specialInstructions });
        const featuredExcluded = ((products || []) as { vendor?: string; title?: string }[]).some((p) => isExcludedVendor(p, lifted));
        if (!featuredExcluded) {
          const before = pool.length;
          pool = pool.filter((p) => !isExcludedVendor(p, lifted));
          if (pool.length !== before) console.log(`[v0] Generate: research pool dropped ${before - pool.length} listing(s) from excluded vendor(s)`);
        }
        catalogPool = pool;
        for (const p of pool) { if (p.vendor) knownVendors.push(p.vendor); if (p.title) knownVendors.push(p.title); }
        const research = buildV2CatalogueResearch(pool, { title, keyword, articleType });
        catalogueResearch = research.text;
        console.log(
          `[v0] Generate: catalogue research scanned ${research.productsScanned} listing(s) in "${handle}", ` +
          `kept ${research.passages} passage(s) from ${research.productsUsed} product(s)`,
        );
      } catch (e) {
        console.warn("[v0] Generate: catalogue research failed, continuing without it:", e instanceof Error ? e.message : e);
      }
    }
    // Comparison table candidates. The writer only knew the featured
    // products, so a two-product article produced a two-row table while the
    // collection held 45 benches. Hand it the strongest products from the
    // whole pool (keyword-scored, priced, deduped against featured) and ask
    // for 4 to 6 rows, capped deterministically at 6 afterwards. linkComparisonTable links and thumbnails any
    // pool product named, so rows become linked cards automatically.
    let cmpBrief = "";
    if (useV2 && catalogPool.length) {
      const kwTokens = String(keyword || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
      const featuredHandles = new Set(((products || []) as { handle?: string }[]).map((p) => String(p.handle || "").toLowerCase()));
      const scored = (catalogPool as { title?: string; handle?: string; vendor?: string; price?: string }[])
        .filter((p) => p.title && p.handle && parseFloat(String(p.price || "0")) > 0)
        .map((p) => {
          const t = String(p.title).toLowerCase();
          const score = kwTokens.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
          return { p, score };
        })
        .filter((x) => x.score > 0 || featuredHandles.has(String(x.p.handle).toLowerCase()))
        .sort((a, b) => b.score - a.score);
      const seen = new Set<string>();
      const cands: string[] = [];
      for (const { p } of scored) {
        const h = String(p.handle).toLowerCase();
        if (seen.has(h)) continue;
        seen.add(h);
        const price = parseFloat(String(p.price || "0"));
        cands.push(`- ${p.title}${p.vendor ? ` (${p.vendor})` : ""}${price > 0 ? ` — $${price.toLocaleString("en-US")}` : ""}`);
        // Hand the writer six, not ten. The old list was ten and the model used
        // all ten however few rows the prompt asked for, which is why 54 of the
        // first 86 revamped articles shipped a ten-row table. The cap below is
        // still enforced in code, but the list is now the right length to start.
        if (cands.length >= 6) break;
      }
      if (cands.length >= 3) {
        cmpBrief =
          `COMPARISON TABLE CANDIDATES — when the article includes a comparison table, build it ` +
          `from THESE products, 4 to 6 rows, NEVER more than 6 (fewer only if this list is shorter). ` +
          `Include the featured products among the rows. Use each product's name close to how it is written ` +
          `here so it can be linked. Pull specs for each row from the catalogue research above; a spec you do ` +
          `not have is written as "Not published", never invented. Do not put any product not on this list ` +
          `in the table.\n${cands.join("\n")}`;
        console.log(`[v0] Generate: comparison candidates — ${cands.length} product(s) offered to the writer`);
      }
    }

    console.log(
      `[v0] Generate: link inventory — ${linkArticles.length} article(s), ${linkCollections.length} collection(s)` +
      (linkArticles.length ? "" : " — NO article URLs supplied, internal links will be suppressed"),
    );

    const systemPrompt = `You are a Senior Content Editor at Peak Primal Wellness, a premium wellness equipment publication.

${useV2 ? `${V2_BODY_SPEC}

${productBrief}

${catalogueResearch}

${cmpBrief}

${linkBrief}` : `OUTPUT FORMAT — You MUST use PPW CSS classes (already defined in the page). Do NOT use inline styles. Do NOT use markdown syntax (**, __, *, _, ##, etc.) — use only HTML tags like <strong>, <em>, <h2>, etc.

STRUCTURE YOU MUST FOLLOW:
1. Start directly with body section content (NO <style>, NO <div class="ppw-wrap">, NO <nav>, NO <h1> — those are added by the template)
2. First section: A "Key Takeaways" box:
   <section class="ppw-section ppw-muted">
   <h2>Key Takeaways</h2>
   <ul><li><strong>Label:</strong> description</li>...</ul>
   </section>
3. Body sections, each wrapped in:
   <section id="SLUG" class="ppw-section">
   <h2>Section Title</h2>
   ...paragraphs, lists, callout boxes...
   </section>
4. Use <div class="ppw-callout"> for important callout blocks
5. Do NOT include any image tags or image placeholders. Images are added separately after content generation.
6. Do NOT include an FAQ section. The FAQ is generated in a separate step — do NOT output any FAQ markup, <details> elements, or "Frequently Asked Questions" headings.
7. If you include a comparison table, it must NEVER be the last section. Always follow a comparison table with a prose wrap-up section (e.g., "Final Thoughts", "Making Your Choice", or a brief conclusion paragraph) so the article body ends with a clean </section> tag containing regular paragraph content.

`}

WRITING GUIDELINES:
- Write in a ${articleTone} tone with genuine expertise
- ${audienceInstruction}
- STRICT WORD COUNT: Write between ${targetWordCount - 200} and ${targetWordCount + 300} words of body content. Do NOT exceed ${targetWordCount + 300} words under any circumstances. Do not pad sections to hit a number — stop when the content is complete.
- Do NOT include any <img> tags or [IMAGE_PLACEHOLDER] markers — images are injected in a later step
- Scannable paragraphs (3-5 sentences)
- Include practical, actionable advice
- Back claims with research findings mentioned naturally
- Use bullet points and numbered lists where appropriate${comparisonInstruction}
- Do NOT add any <h1> tag
- Section IDs must be lowercase-kebab-case
- Do NOT add any internal links or <a> tags to other articles
${typeInstruction ? `\nARTICLE TYPE STRUCTURE:\n${typeInstruction}` : ''}
${WRITING_RULES}

OUTPUT: Return ONLY the section content. No wrapping tags, no <style>, no <html>.`;

    const userPrompt = `Write a comprehensive article about:

TITLE: ${title}
PRIMARY KEYWORD: ${keyword}
CATEGORY: ${categoryLabel}
${articleType ? `ARTICLE TYPE: ${articleType}` : ''}
${collectionContext}
${specialContext}

Requirements:
- Well-researched, engaging, optimized for "${keyword}"
- Do NOT include any image tags or image placeholders
- Do NOT include an FAQ section (it is generated separately)
${useV2
  ? `- Do NOT write a key-takeaways box, a table of contents, a shop CTA or a related-articles list. Those are assembled separately.
- Every section: <h2 class="ppwb-h2" id="kebab-case-id">Title</h2> then <p class="ppwb-p">`
  : `- Key Takeaways section first using ppw-muted class
- All sections use ppw-section class with kebab-case IDs`}`;

    console.log("[v0] Generate: calling AI for PPW body content...");
    // Cap tokens dynamically: words ÷ 0.75 gives token equivalent, +25% headroom for HTML tags
    // v2 markup is far heavier than v1: step lists, spec strips, callouts and
    // blockquotes are all wrapper-dense, so 25% tag headroom under-counts badly
    // and the body gets cut off mid-sentence. Measured on real v2 output the
    // overhead runs closer to 75%.
    const headroom = useV2 ? 1.75 : 1.25;
    const baseMaxTokens = Math.round((targetWordCount / 0.75) * headroom);
    const tokenCap = includeComparisonTable ? 12000 : 10000;
    const maxTokens = Math.min(tokenCap, baseMaxTokens + (includeComparisonTable ? 1500 : 0));
    // Big bodies (esp. comparison-table articles at ~10k tokens) take well past
    // the default 90s. Give this call up to 220s — it's the long pole, and the
    // route's maxDuration (300s) leaves room for the FAQ + subtitle calls after.
    const bodyContent = stripEmDashes(await callAI(systemPrompt, userPrompt, { maxTokens, timeoutMs: 220_000, retryOnTimeout: false }));
    console.log("[v0] Generate: body content received, length:", bodyContent.length);

    // Clean up any stray markdown syntax or leaked image placeholders
    let cleanedBodyContent = bodyContent
      // Strip any image placeholder tags the AI might still include
      .replace(/<img[^>]*src="?\[IMAGE_PLACEHOLDER_\d+\]"?[^>]*\/?>/gi, '')
      .replace(/\[IMAGE_PLACEHOLDER_\d+\]/g, '')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<em>$1</em>')
      .replace(/(?<!=")#{2,6}\s+(.+)/g, '<h2>$1</h2>')
      .replace(/^\s*[-*]\s+/gm, '\u2022 ');

    // ==================================================================
    // SEPARATE FAQ CALL — FAQ is ALWAYS generated separately.
    // Strip any partial/accidental FAQ the main generation may have
    // produced, then generate a clean one via dedicated call.
    // ==================================================================

    // Strip any FAQ content the main generation may have included
    // (complete sections, partial/truncated sections, or stray FAQ headings)
    const faqFullSectionRegex = /<section\s[^>]*id=["']faq["'][^>]*>[\s\S]*?<\/section>/gi;
    const faqPartialSectionRegex = /<section\s[^>]*id=["']faq["'][^>]*>[\s\S]*/gi;
    const faqHeadingRegex = /<h2[^>]*>\s*Frequently Asked Questions\s*<\/h2>[\s\S]*/gi;

    if (faqFullSectionRegex.test(cleanedBodyContent)) {
      cleanedBodyContent = cleanedBodyContent.replace(faqFullSectionRegex, '');
      console.log("[v0] Generate: Stripped complete FAQ section from body content");
    } else if (faqPartialSectionRegex.test(cleanedBodyContent)) {
      cleanedBodyContent = cleanedBodyContent.replace(faqPartialSectionRegex, '');
      console.log("[v0] Generate: Stripped partial/truncated FAQ section from body content");
    } else if (faqHeadingRegex.test(cleanedBodyContent)) {
      cleanedBodyContent = cleanedBodyContent.replace(faqHeadingRegex, '');
      console.log("[v0] Generate: Stripped stray FAQ heading from body content");
    }

    // Trim any trailing whitespace or unclosed tags left after stripping
    cleanedBodyContent = cleanedBodyContent.replace(/\s+$/, '');

    const openDivs = (cleanedBodyContent.match(/<div[\s>]/gi) || []).length;
    const closeDivs = (cleanedBodyContent.match(/<\/div>/gi) || []).length;
    const openSections = (cleanedBodyContent.match(/<section[\s>]/gi) || []).length;
    const closeSections = (cleanedBodyContent.match(/<\/section>/gi) || []).length;

    const unclosedDivCount = openDivs - closeDivs;
    const unclosedSectionCount = openSections - closeSections;

    if (unclosedDivCount > 0 || unclosedSectionCount > 0) {
      console.warn(`[v0] Generate: Detected unclosed tags — ${unclosedDivCount} div(s), ${unclosedSectionCount} section(s). Closing them to prevent FAQ nesting bug.`);
      for (let i = 0; i < unclosedDivCount; i++) {
        cleanedBodyContent += '\n</div>';
      }
      for (let i = 0; i < unclosedSectionCount; i++) {
        cleanedBodyContent += '\n</section>';
      }
    }

    console.log("[v0] Generate: Making dedicated FAQ call...");
    let brandCheck = validateBrandRules(bodyContent, false, { knownVendors });
    if (!brandCheck.passed) {
      console.warn("[brand-check] Body content warnings:", brandCheck.warnings.join(" | "));
    }

    // ══════════════════════════════════════════════════════════════════════
    // TEMPLATE VERSION 2
    // Header, answer box, TOC, picks, guide link, FAQ, CTA, author and related
    // are all built deterministically from lib/article-v2. The model only
    // writes body sections. Returns early; everything below is the frozen v1
    // path and is not reached when useV2 is true.
    // ══════════════════════════════════════════════════════════════════════
    if (useV2) {
      // The answer box, takeaways and FAQ are separate AI calls that used to see
      // only the title, keyword and category. They had no idea what the body
      // said, so they contradicted it: a brown fat article stated 50 to 59°F and
      // 3 to 11 minute sessions in the body while its own FAQ said 14 to 20°C
      // (57 to 68°F) and 10 to 20 minutes. The body is already finished by the
      // time these run, so give it to them. Costs nothing in latency.
      const bodyFacts = cleanedBodyContent
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 6000);
      const consistency =
        `\n\nTHE ARTICLE BODY IS BELOW. Every figure you state — temperature, ` +
        `duration, frequency, cost, percentage — MUST match it. Do not introduce a ` +
        `number the body does not support, and do not restate one in different ` +
        `units with a different value. If the body gives a range, use that range.` +
        `\n\n${productBrief}\n\n---- ARTICLE BODY ----\n${bodyFacts}`;

      // Section digest for the takeaways: every H2 with the opening of its
      // section, so the five points can cover the whole article rather than
      // the first 6,000 characters of it. Product cards and the shop block are
      // not sections, so they are skipped.
      const sectionDigest = (() => {
        const parts = cleanedBodyContent.split(/(?=<h2\b)/i);
        const out: string[] = [];
        for (const part of parts) {
          const h = part.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
          if (!h) continue;
          if (/ppwb-picks|ppwb-shop|ppwb-related|id="faq"|id="picks"/i.test(part.slice(0, 200))) continue;
          const heading = h[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          const text = part
            .slice(h.index! + h[0].length)
            .replace(/<div class="ppwb-pick[\s\S]*?<\/div>\s*<\/div>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 700);
          if (heading && text) out.push(`## ${heading}\n${text}`);
        }
        return out.join("\n\n").slice(0, 12000);
      })();
      const takeawaysContext =
        `\n\nTHE ARTICLE, SECTION BY SECTION, IS BELOW. Your five takeaways carry its ` +
        `conclusions in order, one per major section where possible. Every figure you ` +
        `state must appear in it.` +
        `\n\n---- ARTICLE SECTIONS ----\n${sectionDigest || bodyFacts}`;

      const [deckRawInitial, answerRaw, faqRaw, takeawaysRaw] = await Promise.all([
        callAI(
          "You write concise article subtitles.",
          `Write a single compelling subtitle sentence (under 150 chars) for an article titled "${title}" about ${keyword}. Return ONLY the sentence, no quotes.`,
          { maxTokens: 100 },
        ).then(stripEmDashes),
        callAI(
          `You are a Senior Content Editor at Peak Primal Wellness.\n${V2_ANSWER_SPEC}`,
          `Article title: "${title}". Primary keyword: ${keyword}. Category: ${categoryLabel}.${consistency}`,
          { maxTokens: 600 },
        ).then(stripEmDashes).then(async (first) => {
          // Reasoning leak guard (the box once shipped a literal <thinking>
          // block). callAI already strips it; if what is left still reads
          // like narration, or is empty, regenerate once with a hard rule.
          if (first && !looksLikeReasoning(first) && first.length >= 40) return first;
          console.warn("[generate] answer looked like leaked reasoning; regenerating");
          const again = await callAI(
            `You are a Senior Content Editor at Peak Primal Wellness.\n${V2_ANSWER_SPEC}\nOutput ONLY the final answer text. The first character of your reply must be the first character of the answer.`,
            `Article title: "${title}". Primary keyword: ${keyword}. Category: ${categoryLabel}.${consistency}`,
            { maxTokens: 600 },
          ).then(stripEmDashes);
          return again && !looksLikeReasoning(again) ? again : "";
        }),
        callAI(
          `You are a Senior Content Editor at Peak Primal Wellness.\n${V2_FAQ_SPEC}\n${WRITING_RULES}`,
          `Article title: "${title}". Primary keyword: ${keyword}. Category: ${categoryLabel}.${consistency}`,
          { maxTokens: 2500 },
        ).then(stripEmDashes),
        callAI(
          `You are a Senior Content Editor at Peak Primal Wellness.\n${V2_TAKEAWAYS_SPEC}\n${WRITING_RULES}`,
          // Takeaways get the body only, not the product brief: with the
          // listings in view the model summarised the products and their
          // prices instead of the article.
          `Article title: "${title}". Primary keyword: ${keyword}. Category: ${categoryLabel}.${takeawaysContext}`,
          { maxTokens: 1200 },
        ).then(stripEmDashes),
      ]);

      const takeaways = parseJsonArrayTolerant<{ label: string; text: string }>(takeawaysRaw)
        .filter((t) => t && typeof t.label === "string" && typeof t.text === "string");

      // FAQ arrives as JSON, which is far more robust than parsing HTML back out.
      let faqPairs: { q: string; a: string }[] = [];
      const toPairs = (raw: string) =>
        parseJsonArrayTolerant<{ q: unknown; a: unknown }>(raw)
          .filter((f): f is { q: string; a: string } => !!f && typeof f.q === "string" && typeof f.a === "string")
          .slice(0, 8);
      faqPairs = toPairs(faqRaw);
      if (faqPairs.length < 4) {
        // Not a parse problem we could repair. One more call, then ship without.
        console.warn(`[v0] Generate v2: FAQ yielded ${faqPairs.length} usable pair(s), regenerating once`);
        try {
          const again = await callAI(
            `You are a Senior Content Editor at Peak Primal Wellness.\n${V2_FAQ_SPEC}\n${WRITING_RULES}`,
            `Article title: "${title}". Primary keyword: ${keyword}. Category: ${categoryLabel}.${consistency}`,
            { maxTokens: 2500 },
          ).then(stripEmDashes);
          const retry = toPairs(again);
          if (retry.length > faqPairs.length) faqPairs = retry;
        } catch (e) {
          console.warn("[v0] Generate v2: FAQ retry failed", e);
        }
      }
      if (!faqPairs.length) console.error("[v0] Generate v2: shipping without FAQ after retry");

      // The deck is the one line most likely to reach for marketing language,
      // because it is the only field explicitly asked to be "compelling". Two
      // shipped before this check existed: "boosts immunity, and transforms your
      // body from the inside out" and "your body's fat-burning furnace". It is a
      // 100-token call, so a failed check is cheap to rewrite.
      let deckRaw = deckRawInitial;
      const deckCheck = validateBrandRules(deckRaw);
      if (!deckCheck.passed) {
        console.warn("[brand-check] deck failed, rewriting:", deckCheck.warnings.join(" | "));
        try {
          const rewritten = await callAI(
            `You write article subtitles for Peak Primal Wellness, a wellness equipment retailer.\n\n` +
              `The subtitle below makes health claims PPW cannot support. Rewrite it so it makes ` +
              `NO health-efficacy claim. Do not say anything boosts immunity, burns fat, detoxes, ` +
              `cures, prevents disease or transforms the body. Describe what the article covers ` +
              `instead of promising an outcome. One sentence, under 150 characters, no quotes.`,
            `PROBLEM: ${deckCheck.warnings.join(" | ")}\n\nSUBTITLE TO FIX:\n${deckRaw}`,
            { maxTokens: 120 },
          );
          const candidate = stripEmDashes(rewritten.trim().replace(/^["']|["']$/g, ""));
          if (candidate && validateBrandRules(candidate).passed) deckRaw = candidate;
          else console.error("[brand-check] deck rewrite still failed the check, shipping the original for review");
        } catch (e) {
          console.warn("[brand-check] deck rewrite call failed", e);
        }
      }

      // FAQ answers are plain text; strip any link the model smuggled in.
      faqPairs = faqPairs.map((f) => ({
        q: f.q,
        a: f.a.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1"),
      }));

      // Competitor brands: repair, do not merely warn. The previous version
      // detected "such as those from Blue Cube or Renu Therapy", logged a
      // warning, and published the sentence anyway. Three steps, in order of how
      // much of the answer they preserve.
      const brandCasualties: string[] = [];

      // 1. Clean appositive removal, where the sentence closes over the gap.
      faqPairs = faqPairs.map((f) => {
        const s1 = scrubUncarriedBrands(f.a, knownVendors);
        if (s1.removed.length) brandCasualties.push(...s1.removed);
        const j = scrubSeoJargon(s1.text);
        if (j.removed.length) brandCasualties.push(...j.removed);
        const jq = scrubSeoJargon(f.q);
        return { q: jq.text, a: j.text };
      });

      // 2. Anything left is embedded in the grammar. Regenerate those answers
      //    once, naming the offence, rather than rewriting prose by regex.
      const stillBad = faqPairs.filter((f) => !validateBrandRules(f.a, false, { knownVendors }).passed);
      if (stillBad.length) {
        console.warn(`[brand-check] regenerating ${stillBad.length} FAQ answer(s) that name uncarried brands`);
        for (const f of stillBad) {
          try {
            const fixed = await callAI(
              `You are rewriting one FAQ answer for Peak Primal Wellness.\n\n` +
                `The answer below names one or more brands PPW does not sell. Rewrite it so it ` +
                `names NO brand at all. Describe the tier instead ("an entry-level model", ` +
                `"a commercial-grade unit"). Keep the same length, the same ` +
                `facts and the same plain tone. Return ONLY the rewritten answer, no quotes, ` +
                `no preamble.`,
              `QUESTION: ${f.q}\n\nANSWER TO FIX:\n${f.a}`,
              { maxTokens: 600 },
            );
            const candidate = stripEmDashes(fixed.trim().replace(/^["']|["']$/g, ""));
            if (candidate && validateBrandRules(candidate, false, { knownVendors }).passed) {
              f.a = candidate;
            }
          } catch (e) {
            console.warn("[brand-check] FAQ rewrite failed", e);
          }
        }
      }

      // 3. Last resort. A competitor plug is worse than a shorter FAQ.
      const beforeDrop = faqPairs.length;
      faqPairs = faqPairs.filter((f) => validateBrandRules(f.a, false, { knownVendors }).passed);
      if (faqPairs.length < beforeDrop) {
        console.error(
          `[brand-check] dropped ${beforeDrop - faqPairs.length} FAQ answer(s) that still named uncarried brands after a rewrite`,
        );
      }

      const faqCheck = validateBrandRules(faqPairs.map((f) => `${f.q} ${f.a}`).join(" "), false, { knownVendors });
      if (brandCasualties.length) {
        console.warn("[brand-check] removed brand clauses:", brandCasualties.join(" | "));
      }

      // TOC from the H2s the model actually wrote. IDs stay generic so Google
      // cannot index descriptive fragments as separate SERP entries.
      // A body that ran out of tokens ends mid-sentence with an unclosed tag.
      // Trim back to the last complete block rather than publishing the stub.
      const sealed = sealTruncatedBody(cleanedBodyContent);
      if (sealed.truncated) console.warn("[v0] Generate v2:", sealed.note);
      cleanedBodyContent = sealed.html;

      // sealTruncatedBody compares tag COUNTS, which is not the same as nesting.
      // An article shipped with its fourth <li class="ppwb-step"> never closed
      // and still counted 23 <li> against 23 </li>, so that guard passed and the
      // FAQ, shop card, author block and keep-reading tiles all rendered inside
      // the open list item. Close what is genuinely open before anything is
      // appended to the body.
      const nested = closeUnclosedBlocks(cleanedBodyContent);
      cleanedBodyContent = nested.html;
      if (nested.closed.length) {
        console.warn(`[v0] Generate v2: body left ${nested.closed.length} tag(s) open, closed them: ${nested.closed.join(", ")}`);
      }

      // Trade vocabulary must never reach a reader. The modifier form deletes
      // cleanly ("the PAA question" -> "the question"); anything else is reported
      // rather than mangled.
      const jargon = scrubSeoJargon(cleanedBodyContent);
      cleanedBodyContent = jargon.text;
      if (jargon.removed.length) {
        console.warn(`[brand-check] removed trade jargon from body: ${jargon.removed.join(" | ")}`);
      }
      if (!jargon.clean) {
        console.error("[brand-check] trade jargon remains in the body and could not be removed safely");
      }

      // The body gets the same treatment as the FAQ. Until now a competitor name
      // or a health claim in a body paragraph was logged and published; only the
      // FAQ and the deck were repaired. Each offending prose block (paragraph,
      // list item, step body) is rewritten once, on its own, with its links
      // required to survive intact. A rewrite that drops or changes an href, or
      // still fails the check, is discarded and the original stays with a
      // warning, so the repair can never make the article worse than it was.
      const repaired = await repairBodyBlocks(cleanedBodyContent, { knownVendors, cap: 14, docLabel: "article" });
      cleanedBodyContent = repaired.html;
      const bodyRepairNotes: string[] = repaired.notes;
      if (bodyRepairNotes.length) {
        // Re-run the body check on the repaired text so the review panel reports
        // what actually ships, not what the model first wrote.
        brandCheck = validateBrandRules(cleanedBodyContent, false, { knownVendors });
      }

      // Capture the attribute string so data-nav survives. The heading is then
      // rebuilt with a generic id, which also strips data-nav out of the
      // published HTML: it is nav metadata, not something a reader needs.
      const h2s = Array.from(cleanedBodyContent.matchAll(/<h2([^>]*)>([\s\S]*?)<\/h2>/gi));
      const tocItems: { id: string; text: string; navLabel?: string }[] = [];
      let bodyForV2 = cleanedBodyContent;
      h2s.forEach((m, i) => {
        const attrs = m[1] || "";
        const text = m[2].replace(/<[^>]+>/g, "").trim();
        if (!text) return;
        const id = `section-${i + 1}`;
        // Capture the delimiter and match to it. [^"']+ excludes BOTH quote
        // characters regardless of which one opened the attribute, so
        // data-nav="What research can't confirm" was truncated at the apostrophe
        // and the nav read "What research can".
        const navAttr = /\bdata-nav=(["'])([\s\S]*?)\1/i.exec(attrs);
        tocItems.push({ id, text, navLabel: navAttr ? navAttr[2].trim() : undefined });
        bodyForV2 = bodyForV2.replace(m[0], `<h2 class="ppwb-h2" id="${id}">${text}</h2>`);
      });
      // Deterministic half of the link rule. The inventory in the prompt is a
      // request; this is the guarantee. Anything pointing at the site that was
      // not on the list gets unwrapped to plain text, so a dead link can never
      // reach a published page even when the model ignores the brief.
      const linkSeal = sealV2Links(bodyForV2, linkInventory);
      bodyForV2 = linkSeal.html;
      // The model links from the inventory and add-links later links from the
      // same inventory, so one URL can end up wrapped twice in a paragraph.
      const linkDedupe = dedupeV2Links(bodyForV2);
      bodyForV2 = linkDedupe.html;
      // Back-to-back anchors read as one link. Unwrap the second.
      const linkSplit = splitAdjacentLinks(bodyForV2);
      bodyForV2 = linkSplit.html;
      // Comparison table rows that name a product PPW sells link to it, with a
      // thumbnail. Featured products first so the card and the row agree, then
      // the rest of the collection.
      const tableLinks = linkComparisonTable(bodyForV2, [...((products || []) as typeof catalogPool), ...catalogPool], (products || []).length);
      bodyForV2 = tableLinks.html;
      if (tableLinks.linked.length) {
        console.log(`[v0] Generate v2: linked ${tableLinks.linked.length} comparison row(s) to products: ${tableLinks.linked.join(" | ")}`);
      }
      // Six rows maximum. A prompt rule is a request; this is the guarantee.
      // Linked rows are kept first, so a trimmed table shows what PPW sells.
      const cmpCap = capComparisonRows(bodyForV2, 6);
      bodyForV2 = cmpCap.html;
      if (cmpCap.dropped.length) {
        console.warn(`[v0] Generate v2: comparison table over 6 rows, dropped: ${cmpCap.dropped.join(" | ")}`);
      }
      // A column that is mostly "Not published" is a column of noise.
      const cmpCols = dropEmptyComparisonColumns(bodyForV2);
      bodyForV2 = cmpCols.html;
      if (cmpCols.dropped.length) {
        console.warn(`[v0] Generate v2: dropped mostly-empty comparison column(s): ${cmpCols.dropped.join(", ")}`);
      }
      // Exactly two collection links. Extra ones become plain text.
      const linkCap = capCollectionLinks(bodyForV2, 2);
      bodyForV2 = linkCap.html;
      if (linkCap.unwrapped.length) {
        console.warn(`[v0] Generate v2: unwrapped ${linkCap.unwrapped.length} collection link(s) over the limit of 2: ${linkCap.unwrapped.join(", ")}`);
      }
      // And fewer than two gets filled from the candidate list, own
      // collection first, at the first plain mention of the subject.
      const linkFill = fillCollectionLinks(
        bodyForV2,
        [
          ...(ownCollection ? [{ title: ownCollection.label, url: `/collections/${ownCollection.shopifyHandle}` }] : []),
          ...linkCollections,
        ],
        2,
      );
      bodyForV2 = linkFill.html;
      if (linkFill.added.length) {
        console.log(`[v0] Generate v2: filled collection link(s): ${linkFill.added.join(" | ")}`);
      }
      if (linkSplit.unwrapped.length) {
        console.warn(`[v0] Generate v2: unwrapped ${linkSplit.unwrapped.length} adjacent link(s): ${linkSplit.unwrapped.join(", ")}`);
      }
      if (linkDedupe.collapsed.length) {
        console.warn(`[v0] Generate v2: collapsed ${linkDedupe.collapsed.length} repeated link(s): ${linkDedupe.collapsed.join(", ")}`);
      }
      if (linkSeal.stripped.length) {
        console.warn(
          `[v0] Generate v2: stripped ${linkSeal.stripped.length} invented link(s): ${linkSeal.stripped.join(", ")}`,
        );
      }

      // Product blocks stay out of the jump nav. A reader scanning "on this page"
      // is orienting in the article, and a nav entry that lands them on a product
      // card is a bait. The picks blocks still carry their ids for deep links.
      if (faqPairs.length) tocItems.push({ id: "faq", text: "FAQ" });

      // Ultimate guide: the MOST SPECIFIC collection whose guide fits the title.
      // An article filed under "saunas" about barrel saunas should point at the
      // barrel sauna guide, not the general one. Every collection with a guide
      // is scored by how many of its slug words appear in the title and
      // keyword; all of them must, and more words beats fewer. The article's
      // own collection is the fallback, then the hardcoded map.
      let v2Guide = CATEGORY_ULTIMATE_GUIDE[category] as { title: string; url: string } | undefined;
      // An explicit guide on the request (planned in the content brain for a
      // cluster whose collection record has no guide yet) wins outright.
      const explicitGuide = body.ultimateGuide as { url?: string; title?: string } | undefined;
      const explicitUrl = (explicitGuide?.url || "").trim();
      if (explicitUrl && /^\/pages\//.test(explicitUrl)) {
        v2Guide = {
          url: explicitUrl,
          title: explicitGuide?.title?.trim() || `The Ultimate Guide to ${categoryLabel}`,
        };
        console.log(`[v0] Generate v2: ultimate guide from the request: ${explicitUrl}`);
      }
      if (!explicitUrl) try {
        const sql = getSQL();
        const rows = Array.from(await sql`
          SELECT slug, ultimate_guide_title, ultimate_guide_url
          FROM ppw_collections
          WHERE ultimate_guide_url IS NOT NULL AND ultimate_guide_url <> ''`) as
          { slug: string; ultimate_guide_title: string; ultimate_guide_url: string }[];
        const norm = (t: string) => ` ${t.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
        const hay = norm(`${title} ${keyword}`);
        const kw = norm(keyword || "");
        const singular = (w: string) => w.replace(/s$/, "");
        const has = (text: string, w: string) => text.includes(` ${w} `) || text.includes(` ${singular(w)} `) || text.includes(` ${w}s `);
        // Score: every slug word must appear in title or keyword. A slug whose
        // words all sit inside the KEYWORD outranks one that only matches the
        // title, because the keyword names the subject and the title adds
        // colour ("...for Traditional Outdoor Heat" made outdoor-saunas tie
        // with barrel-saunas on a barrel sauna article). More words beats
        // fewer, and a word appearing earlier in the title breaks the rest.
        let bestScore = -1;
        let best: typeof rows[number] | undefined;
        for (const r of rows) {
          const words = r.slug.toLowerCase().split("-").filter((w) => w.length > 2);
          if (!words.length) continue;
          if (!words.every((w) => has(hay, w))) continue;
          const inKeyword = words.every((w) => has(kw, w)) ? 100 : 0;
          const firstPos = Math.min(...words.map((w) => { const i = hay.indexOf(` ${singular(w)}`); return i < 0 ? 999 : i; }));
          const score = inKeyword + words.length * 10 - Math.min(firstPos, 9) / 10;
          if (score > bestScore) { bestScore = score; best = r; }
        }
        const own = rows.find((r) => r.slug === category || r.slug === ownCollection?.shopifyHandle);
        const pick = best || own;
        if (pick?.ultimate_guide_url) {
          v2Guide = { title: pick.ultimate_guide_title, url: pick.ultimate_guide_url };
          console.log(`[v0] Generate v2: ultimate guide from "${pick.slug}"${best ? " (title match)" : " (own collection)"}`);
        }
      } catch (e) {
        console.warn("[v0] Generate v2: guide lookup failed, using fallback", e);
      }

      const author = pickAuthor(category, String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-"), articleType);

      // Card order. The two cards above the body are the first thing the
      // reader sees, so they should not be two of the same kind of product
      // (the batch shipped two Swedish ladders up top with both functional
      // trainers pushed below the fold). Interleave by product type or, if
      // types are missing, by vendor, so the top pair shows the range.
      const pickOrder = (() => {
        const list = [...(products || [])];
        const keyOf = (p: (typeof list)[number]) =>
          String((p as { productType?: string }).productType || (p as { vendor?: string }).vendor || "").toLowerCase();
        if (list.length < 3) return list;
        const first = list[0];
        const k = keyOf(first);
        const idx = list.findIndex((p, i) => i > 0 && keyOf(p) !== k);
        if (idx <= 1) return list;
        const [other] = list.splice(idx, 1);
        list.splice(1, 0, other);
        return list;
      })();
      // "Two home gym equipment to start with" is not English. Mass nouns
      // (equipment, gear) do not pluralise and do not take a count. Keep the
      // label in the lower heading, where it reads as a category, and avoid
      // counting it.
      const pickNoun = categoryLabel.toLowerCase();

      const v2Html = buildV2Document([
        buildV2Header({
          title,
          deck: deckRaw.trim(),
          kicker: categoryLabel,
          hubLabel: categoryLabel,
          // The breadcrumb's tagged URL must match the tag the article
          // publishes with (slug of the trimmed label), or it 404s now that
          // tags are "home-gym-equipment" rather than the full handle.
          hubUrl: `/blogs/wellness/tagged/${categoryLabel.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`,
          readTime,
          author,
        }),
        buildV2Answer(answerRaw.trim()),
        buildV2Takeaways(takeaways),
        buildV2Toc(tocItems),
        buildV2GuideLink(v2Guide),
        // Two picks up top, two after the body. Four cards plus a jump menu
        // before any prose pushed the article itself below the fold.
        buildV2Picks(
          pickOrder.slice(0, 2),
          (prod) => extractFeatures(prod),
          `Where to start`,
        ),
        bodyForV2,
        buildV2Picks(
          pickOrder.slice(2, 4),
          (prod) => extractFeatures(prod),
          `More ${pickNoun} worth a look`,
          { anchor: "more-picks" },
        ),
        buildV2Faq(faqPairs),
        buildV2ShopCta({
          kicker: categoryLabel,
          collectionSlug,
          collectionLabel: categoryLabel,
          // The CTA's HSA/FSA line keys on the HUB (recovery, clinical). This was
          // passed the collection slug, so the line never rendered anywhere.
          hub: articleHub,
        }),
        buildV2Author(author),
        buildV2Related(relatedForV2),
      ]);

      const v2Schema = faqPairs.length
        ? `\n<script type="application/ld+json">\n${JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faqPairs.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a.replace(/<[^>]+>/g, "") },
            })),
          }, null, 2)}\n</script>`
        : "";

      // Link budget: 4-6 internal and exactly 2 in-context collection links, all
      // from the supplied inventory, and zero external. Counted on the body the
      // model wrote, not the assembled page, so the deterministic blocks (shop
      // CTA, guide link, related tiles) do not flatter the numbers.
      const linkAudit = auditV2Links(bodyForV2, linkInventory);
      if (linkAudit.collections !== 2) {
        console.error(
          `[v0] Generate v2: ${linkAudit.collections} in-body collection link(s), the rule is exactly 2. ` +
          `Run the link step to top this up before publishing.`,
        );
      }
      if (!faqCheck.passed) {
        linkAudit.warnings.push(...faqCheck.warnings.map((w) => `FAQ: ${w}`));
        linkAudit.passed = false;
      }
      // Anchor text that is just the destination's title reads as a signpost
      // rather than a link. Reported: the fix is rewriting the sentence.
      const lazyAnchors = auditAnchorText(bodyForV2, linkTitles);
      if (lazyAnchors.length) {
        linkAudit.warnings.push(
          `${lazyAnchors.length} link(s) use the destination's title as anchor text instead of a natural phrase: ${lazyAnchors.join("; ")}`,
        );
        linkAudit.passed = false;
        console.warn("[v0] Generate v2: lazy anchor text:", lazyAnchors.join(" | "));
      }

      const finalDeckCheck = validateBrandRules(deckRaw);
      if (!finalDeckCheck.passed) {
        linkAudit.warnings.push(...finalDeckCheck.warnings.map((w) => `deck: ${w}`));
        linkAudit.passed = false;
      }
      if (!brandCheck.passed) {
        linkAudit.warnings.push(...brandCheck.warnings.map((w) => `body: ${w}`));
        linkAudit.passed = false;
      }
      if (bodyRepairNotes.length) {
        linkAudit.warnings.push(...bodyRepairNotes.map((w) => `body repair: ${w}`));
      }
      if (linkSeal.stripped.length) {
        linkAudit.warnings.unshift(
          `${linkSeal.stripped.length} invented link(s) stripped to plain text: ${linkSeal.stripped.join(", ")}`,
        );
      }
      if (sealed.truncated) linkAudit.warnings.unshift(sealed.note);
      if (!linkAudit.passed || sealed.truncated) {
        console.warn("[v0] Generate v2: link budget:", linkAudit.warnings.join(" | "));
      }

      console.log("[v0] Generate v2: assembled", v2Html.length, "chars,", faqPairs.length, "FAQs");
      return NextResponse.json({
        content: `${v2Html}${v2Schema}`.trim(),
        wordCount: targetWordCount,
        metaDescription: deckRaw.trim().slice(0, 160),
        templateVersion: 2,
        linkAudit,
        strippedLinks: linkSeal.stripped,
        truncated: sealed.truncated,
      });
    }

    const faqSystemPrompt = `You are a Senior Content Editor at Peak Primal Wellness. Generate ONLY an FAQ section for an article. Output ONLY the HTML below — no explanation, no markdown, no wrapping tags.

FORMAT (use this EXACT structure):
<section id="faq" class="ppw-section">
<h2>Frequently Asked Questions</h2>
<div class="ppw-faq-list">
<details class="ppw-faq-item"><summary class="ppw-faq-question">Question?</summary><div class="ppw-faq-answer"><p>Answer paragraph.</p></div></details>
</div>
</section>

RULES:
- Write exactly 8 high-quality questions a reader would actually ask — no more, no less
- Each answer should be 2-3 sentences, informative and specific
- Questions should cover different aspects (benefits, safety, cost, setup, maintenance, etc.)
- Do NOT use markdown syntax — HTML only
- Do NOT include any content outside the <section> tags
- Do NOT include comparison tables, product grids, or any ppw-grid / ppw-card markup. This is an FAQ section ONLY — no product comparisons, feature grids, or tabular layouts.`;

    const faqUserPrompt = `Write an FAQ section for this article:

TITLE: ${title}
KEYWORD: ${keyword}
CATEGORY: ${categoryLabel}`;

    const faqContent = stripEmDashes(await callAI(faqSystemPrompt, faqUserPrompt, { maxTokens: 2000 }));
    const cleanedFaqContent = faqContent
      .replace(/^```html?\n?/i, '').replace(/\n?```$/i, '')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<em>$1</em>')
      // Strip any comparison table / product grid markup that leaked into FAQ
      .replace(/<div\s+class="ppw-grid[^"]*">[\s\S]*?<\/div>\s*<\/div>/gi, '')
      .replace(/<div\s+class="ppw-card[^"]*">[\s\S]*?<\/div>/gi, '')
      .trim();

    // Validate the FAQ output has the expected structure before appending
    if (cleanedFaqContent.includes('id="faq"') && cleanedFaqContent.includes('ppw-faq-item')) {
      cleanedBodyContent = cleanedBodyContent + '\n' + cleanedFaqContent;
      console.log("[v0] Generate: FAQ section generated and appended successfully");
    } else {
      console.warn("[v0] Generate: FAQ call returned unexpected format, skipping:", cleanedFaqContent.substring(0, 200));
    }

    // ==================================================================
    // EXTRACT & PARSE — Pull out FAQ, headings, key takeaways
    // ==================================================================

    // Extract FAQ section
    const faqRegex = /<section\s[^>]*id=["']faq["'][^>]*>[\s\S]*<\/section>/i;
    const faqMatch = cleanedBodyContent.match(faqRegex);
    const faqSection = faqMatch ? faqMatch[0] : "";
    const mainContent = faqMatch ? cleanedBodyContent.replace(faqRegex, "").trim() : cleanedBodyContent;

    // Sanitize FAQ section — strip any stray block-level closing tags the AI
    // occasionally injects inside <div class="ppw-faq-answer"> blocks
    // (e.g. </section>, </article>) which break the HTML structure
    let cleanFaqSection = faqSection;
    if (cleanFaqSection) {
      cleanFaqSection = cleanFaqSection.replace(
        /(<div class="ppw-faq-answer">)([\s\S]*?)(<\/div>)/gi,
        (match: string, open: string, body: string, close: string) => {
          // Remove any stray </section>, </article>, or comparison grid markup inside answer bodies
          const cleanBody = body
            .replace(/<\/section>/gi, '')
            .replace(/<\/article>/gi, '')
            .replace(/<div\s+class="ppw-grid[^"]*">[\s\S]*?<\/div>/gi, '')
            .replace(/<div\s+class="ppw-card[^"]*">[\s\S]*?<\/div>/gi, '');
          return open + cleanBody + close;
        }
      );
    }

    // Parse FAQ items for schema
    const faqItems: { question: string; answer: string }[] = [];
    if (cleanFaqSection) {
      const questionMatches = Array.from(cleanFaqSection.matchAll(/<summary[^>]*>(.*?)<\/summary>/gi));
      const answerMatches = Array.from(cleanFaqSection.matchAll(/<div class="ppw-faq-answer">([\s\S]*?)<\/div>/gi));
      questionMatches.forEach((qm, i) => {
        const q = qm[1].replace(/<[^>]+>/g, "").trim();
        const a = answerMatches[i] ? answerMatches[i][1].replace(/<[^>]+>/g, "").trim() : "";
        if (q && a) faqItems.push({ question: q, answer: a });
      });
    }

    // Parse section headings for navigation. Anchor IDs are GENERIC + sequential
    // (section-1, section-2, …) so Google can't index descriptive "#heading-slug"
    // fragments as separate SERP entries. The visible nav LABELS stay descriptive.
    const headingMatches = Array.from(mainContent.matchAll(/<h2[^>]*(?:id="([^"]*)")?[^>]*>(.*?)<\/h2>/gi));
    const navItems: { id: string; text: string }[] = [];
    headingMatches.forEach((match, i) => {
      const text = match[2].replace(/<[^>]+>/g, "").trim();
      if (text) navItems.push({ id: `section-${i + 1}`, text });
    });

    // Rewrite each heading to carry only its generic ID (drops any existing id).
    let processedContent = mainContent;
    navItems.forEach((nav) => {
      const escapedText = nav.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const headingRegex = new RegExp(`<h2[^>]*>\\s*${escapedText}\\s*</h2>`, "i");
      processedContent = processedContent.replace(headingRegex, `<h2 id="${nav.id}">${nav.text}</h2>`);
    });

    // Nav is generated AFTER full assembly to include all final H2 sections
    // (placeholder — actual nav built below after bodyWithProducts)

    // ==================================================================
    // BUILD — Overview / Hero section
    // ==================================================================
    const subtitlePrompt = `Write a single compelling subtitle sentence (under 150 chars) for an article titled "${title}" about ${keyword}. Return ONLY the sentence, no quotes.`;
    const subtitle = stripEmDashes(await callAI("You write concise article subtitles.", subtitlePrompt, { maxTokens: 100 }));

    const overviewHtml = `<section id="overview" class="ppw-section">
<div class="ppw-kicker">${categoryLabel}</div>
<h1>${title}</h1>
<p class="ppw-subtitle">${subtitle.trim()}</p>
<div class="ppw-meta"><span>By Peak Primal Wellness</span><span class="ppw-dot"></span><span>${readTime} min read</span></div>
</section>`;

    // ==================================================================
    // BUILD — Featured Products section
    // ==================================================================
    let productsHtml = "";
    if (products && products.length > 0) {
      // Always show up to 4 products in a 2-column grid (2x2)
      const displayProducts = products.slice(0, 4);
      const cards = displayProducts.map((p: { title: string; description?: string; price?: string; imageUrl?: string; url?: string; handle?: string; vendor?: string; tags?: string }, i: number) => buildProductCard(p, i, displayProducts)).join("\n");
      productsHtml = `\n<section id="featured-products" class="ppw-section">
<h2 class="ppw-center">Top ${categoryLabel} Picks</h2>
<p style="margin-bottom:3rem;color:#666;font-size:1.6rem;" class="ppw-center">Premium quality with pre-delivery inspection and expert support.</p>
<div class="ppw-grid cols-2">
${cards}
</div>
</section>`;
    }

    // ==================================================================
    // BUILD — Ultimate Guide Link (inserted after Key Takeaways)
    // DB is source of truth; hardcoded map is fallback during migration.
    // ==================================================================
    let ultimateGuideHtml = "";
    let guideEntry = CATEGORY_ULTIMATE_GUIDE[category];
    try {
      const sql = getSQL();
      const rows = await sql`
        SELECT ultimate_guide_title, ultimate_guide_url
        FROM ppw_collections
        WHERE slug = ${category}
          AND ultimate_guide_url IS NOT NULL
        LIMIT 1
      `;
      const row = Array.from(rows)[0] as { ultimate_guide_title: string; ultimate_guide_url: string } | undefined;
      if (row?.ultimate_guide_url) {
        guideEntry = { title: row.ultimate_guide_title, url: row.ultimate_guide_url };
      }
    } catch (e) {
      console.warn(`[v0] Generate: DB ultimate guide lookup failed for "${category}", using hardcoded fallback`, e);
    }
    if (!guideEntry) {
      console.warn(`[v0] Generate: No Ultimate Guide mapping found for category="${category}" — skipping Go Deeper box`);
    }
    if (guideEntry) {
      // Palette corrected Aug 2026: this callout used a dark green (#2d6a4f)
      // that appears in no PPW palette. Now cream ground with the gold left
      // rule, matching the .ppw-pillar treatment on collection pages. The
      // ppw-guide-callout class is still defined in no stylesheet, so the
      // inline styles are load-bearing until the v2 template lands.
      ultimateGuideHtml = `\n<section class="ppw-section ppw-guide-callout" style="background:#faf7f1;border-left:3px solid #c8a96e;border-radius:8px;padding:2.4rem 3rem;margin:3rem 0;">
<p style="margin:0;font-size:1.6rem;color:#8a6d2f;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">Go deeper</p>
<p style="margin:0.8rem 0 0;font-size:1.5rem;line-height:1.6;color:#4b5563;">Want the full picture? Read our <a href="${guideEntry.url}" style="color:#09195B;font-weight:700;text-decoration:underline;">${guideEntry.title}</a> for everything you need to know.</p>
</section>`;
    }

    // ==================================================================
    // BUILD — Related Articles footer
    // ==================================================================
    const relatedHtml = buildRelatedArticlesHtml(relatedArticles || []);

    // ==================================================================
    // BUILD — Shop CTA
    // ==================================================================
    const ctaHtml = `\n<section class="ppw-section ppw-center">
<a href="/collections/${collectionSlug}" class="ppw-cta">Shop The Collection</a>
</section>`;

    // ==================================================================
    // BUILD — FAQ Schema JSON-LD
    // ==================================================================
    const faqSchema = faqItems.length > 0
      ? `\n<script type="application/ld+json">\n${JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqItems.map((f) => ({
            "@type": "Question",
            name: f.question,
            acceptedAnswer: { "@type": "Answer", text: f.answer },
          })),
        }, null, 2)}\n</script>`
      : "";

    // ==================================================================
    // FINAL ASSEMBLY — Full PPW article
    // Insert AFTER Key Takeaways (first </section> in body):
    //   1. Ultimate Guide Link
    //   2. Featured Products
    //   3. Rest of article
    // ==================================================================
    let bodyWithProducts = processedContent;
    const afterKeyTakeaways = ultimateGuideHtml + productsHtml;
    if (afterKeyTakeaways) {
      const firstSectionEnd = processedContent.indexOf('</section>');
      if (firstSectionEnd !== -1) {
        const insertAt = firstSectionEnd + '</section>'.length;
        bodyWithProducts = processedContent.slice(0, insertAt) + afterKeyTakeaways + processedContent.slice(insertAt);
      } else {
        bodyWithProducts = afterKeyTakeaways + processedContent;
      }
    }

    // ==================================================================
    // BUILD — PPW Navigation (from FINAL assembled content)
    // Parse all H2s from the completed article body to catch every section
    // ==================================================================
    const fullBodyForNav = `${bodyWithProducts}${cleanFaqSection}`;
    const excludeNavPatterns = ['continue-your', 'shop', 'key-takeaway'];
    const finalH2Regex = /<h2([^>]*)>(.*?)<\/h2>/gi;
    const finalNavItems: { id: string; text: string }[] = [];
    let navMatch;
    while ((navMatch = finalH2Regex.exec(fullBodyForNav)) !== null) {
      const text = navMatch[2].replace(/<[^>]+>/g, "").trim();
      const idMatch = navMatch[1].match(/id="([^"]*)"/);
      const id = idMatch ? idMatch[1] : text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (!excludeNavPatterns.some(p => id.includes(p)) && text) {
        finalNavItems.push({ id, text });
      }
    }

    const navLinks = [
      `<a href="#overview">Overview</a>`,
      ...finalNavItems.map((n) => `<a href="#${n.id}">${n.text}</a>`),
    ];
    const navHtml = `<nav class="ppw-topnav" aria-label="Quick navigation">\n${navLinks.join("\n")}\n</nav>`;

    const finalHtml = `${PPW_STYLES}

<div class="ppw-wrap" style="text-align: start;">
<article class="ppw-container ppw-article" itemscope itemtype="https://schema.org/Article">

${navHtml}

${overviewHtml}
${bodyWithProducts}
${cleanFaqSection}
${relatedHtml}
${ctaHtml}

</article>
</div>
${faqSchema}`.trim();

    console.log("[v0] Generate: PPW article assembled, total length:", finalHtml.length);

    return NextResponse.json({
      content: finalHtml,
      wordCount: targetWordCount,
      metaDescription: subtitle.trim().slice(0, 160),
    });
  } catch (error) {
    console.error("[v0] Generation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate content" },
      { status: 500 }
    );
  }
}
