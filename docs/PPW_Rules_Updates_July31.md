# PPW Collection Rules — Updates Log
## Session: July 31, 2026

All changes identified during today's testing session across the barrel sauna, hybrid sauna, ultra-low EMF, sauna buckets, and sauna heaters collections.
Organized by which file needs updating.

---

## Updates to PPW_Collection_Page_Rules.md

---

### 1. Compare Table Rule — Replace Entirely

**Old rule:** Remove the compare table if a buying guide is present. Never include both.

**New rule:** Compare table inclusion is determined by the collection's median product price from the Shopify feed.

| Median Variant Price | Compare Table |
|---|---|
| Under $300 | Omit. Buying guide alone covers the decision. |
| $300 to $1,000 | Include if products have three or more meaningfully different specs. Omit if products are primarily size variants of the same item. |
| Over $1,000 | Always include. Buying guide and compare table coexist. |

The buying guide covers the decision framework. The compare table covers model-level differentiation. On high-AOV equipment pages these are sequential steps in the buyer's journey, not redundant sections.

Compare tables on equipment pages carry SEO keyword density from model names, spec terminology, brand names, and price points that do not exist in other sections. Removing them from equipment collections is a mistake for both UX and SEO.

---

### 2. Compare Table — Image Column Required

**New rule:** Every compare table must include a product thumbnail as the first column.

- Image: 96px wide, `border-radius:8px`, pulled from `product.images[0].src` in the Shopify feed
- Model name in a bold div below the image
- Column fixed width approximately 140px
- Text-only compare tables are not acceptable for published pages

---

### 3. Featured Products Count

**Old rule:** Exactly four product tiles.

**Clarification:** The new Claude Design template uses three featured products ("Three we recommend first"). Both three and four are acceptable depending on which template variant is being used. The generator should match the count used in the template being applied. ItemList schema must match whichever count is displayed — three tiles means three ItemList entries, four means four.

---

### 4. CTA Button Text

**Old rule:** CTA button text is always "View Product Details →"

**Updated rule:** Two formats are acceptable.

- "View Product Details →" — default for all collections
- "View [Short Model Name] ›" — acceptable when the product name is long and a short identifying label is available (e.g. "View Profile ONE ›", "View SaunaZone ›")

Brand collection pages may use product-specific CTA labels. Category collection pages default to "View Product Details →" unless the template design uses a different format.

---

### 5. Care / Ownership Section — Two Variants

**Old rule:** Always three H3 headings: Cleaning and Daily Care, Routine Maintenance, Warranty Coverage.

**Updated rule:** Two variants based on product type, not price. The determining question is: does this product require freight shipping, dedicated space, electrical or plumbing considerations, and ongoing maintenance? If yes, use the equipment variant. If no, use the accessory variant.

**Equipment ownership variant**
Use for: Saunas, hyperbaric chambers, cold plunges, sauna heaters, gym equipment, cardio equipment, water ionizers — anything that ships freight, requires setup, and involves ongoing maintenance beyond a quick wipe-down.

H3 headings:
- Shipping and Freight
- Setup and Installation
- Care and Maintenance

**Accessory ownership variant**
Use for: Sauna buckets and ladles, thermometers, backrests, towels, aromatherapy products, light therapy accessories, recovery tools, small consumables — anything that ships standard ground, requires no setup, and care is simply rinse and dry.

H3 headings:
- Warranty and Support
- Care and Cleaning
- Returns

Warranty stays in both variants because buyers always want coverage details regardless of product size. The returns section is prominent in the accessory variant because buyers may exchange sizes or materials. For equipment, returns policy belongs on the shipping page rather than the collection description.

**Generator detection logic:** Check the Shopify product type field from the feed. Product types like "Sauna," "Sauna Heater," "Hyperbaric Chamber," "Cold Plunge," "Gym Equipment," "Cardio Equipment," "Water Ionizer" trigger the equipment variant. Product types like "Sauna Accessory," "Recovery Tool," or any accessory category trigger the accessory variant.

---

### 6. FAQ Position

**Confirmed:** FAQ at the end of the page (after learning center, before or at the very end) is the correct position for the new template. Do not move FAQ to second position after the overview.

FAQPage schema communicates all questions to Google independently of visual position. The commercial content (overview, picks, buying guide, benefits) stays near the top where it converts. FAQ serves as a catch-all for buyer hesitations before the ownership and care sections close the page.

---

### 7. Keyword Plural and Singular — Grader Rule

**New rule:** Keyword presence checks in the grader are singular and plural agnostic.

When evaluating whether a target keyword appears in H1, H2, meta title, or meta description, normalize both the keyword and the field to stem form before comparing. A keyword fails the check only if neither the singular nor the plural form appears.

Examples that must pass:
- "barrel sauna" matches "barrel saunas" ✅
- "hyperbaric chamber" matches "hyperbaric chambers" ✅
- "infrared sauna" matches "infrared saunas" ✅
- "ultra-low EMF sauna" matches "ultra-low EMF saunas" ✅

Apply this rule in both the grader and the keyword injection map during generation.

---

### 8. Learning Center Cluster Card Headlines

**Clarification added:** Cluster card headlines must match the exact published page title of the linked blog post. Before generating the learning center section, verify that each linked blog post exists on the site and that the headline used in the cluster card matches the post's actual H1.

Wrong links from today's testing: the sauna buckets learning center included "Best Wooden Cold Plunge: Premium ThermoWood & Cedar Options" (cold plunge content) and "How to Set Up a Sauna Tent: Step-by-Step Guide" (tangentially related). Both are wrong for a buckets and ladles collection. The tool must match cluster card links to the collection's actual topic, not pull from a generic pool of recent blog posts.

If fewer than three topically relevant blog posts exist for the collection, flag this as a content gap and omit the section rather than using off-topic posts to fill the slots.

---

### 9. Sub-Collection Navigation Tiles — Preserved Element

**New rule (also in generator instructions):** Sub-collection navigation tiles are preserved elements, treated identically to the learning center.

Detection: any grid of linked tiles where `href` values point to `/collections/` URLs rather than `/products/` URLs.

These tiles must never be removed, restructured, or used as a substitute for the featured products section. They are extracted before generation, preserved exactly, and reinserted after the featured products section in the generated output. The corresponding nav link is also preserved.

---

### 10. Pre-Generation Product Depth Gate — Update

**Updated thresholds:**

| Product Count | Action |
|---|---|
| Under 10 | Do not generate. Flag for product expansion. |
| 10 to 20 | Generate with depth warning in output. |
| 20 or more | Generate with no flag. |

No change to the rule — just confirming these thresholds are correct based on testing.

---

## Updates to PPW_Collection_Generator_Cowork_Instructions.md

---

### 1. Compare Table Inclusion Step — Add to Generation Workflow

After the product type detection step and before generating any sections, the generator must:

1. Pull all variant prices for the collection from the Shopify product feed
2. Calculate the median variant price
3. Apply the compare table rule:
   - Median under $300: generate buying guide only, no compare table, remove #compare nav link
   - Median $300 to $1,000: check if products have 3+ meaningfully different specs. If yes, include compare table. If no, buying guide only.
   - Median over $1,000: generate both buying guide and compare table, include both nav links

---

### 2. Compare Table Generation — Image Column

When generating a compare table, the first column must be built using `product.images[0].src` from the Shopify feed for each product in the table. Structure:

```html
<td style="width:140px;text-align:center;padding:10px 8px">
  <img src="{image_src}" alt="{product_title}"
       style="width:96px;height:auto;border-radius:8px;border:1px solid #e5e7eb;">
  <div style="margin-top:.35rem;font:700 12px/1.3 Poppins,sans-serif;color:#09195B">
    {short_model_name}
  </div>
</td>
```

---

### 3. Tasks 6, 9, and 11 — Shopify Feed Integration

These three tasks require product data at generation time. The fix documented in the previous cowork brief applies:

**Task 6 and 11:** Pull `product.images[0].src`, `product.handle`, `product.title`, and `variants[0].price` from the Shopify products API at the start of every run. Select three or four representative products (entry, mid, large/comfort, premium) and generate featured product tiles from this live data. Build the ItemList schema entries from the same four products in the same step.

**Task 9:** Pass each buying guide card's existing content through a generation call asking for a verb-led heading under six words that matches the decision the card covers. Replace the heading in place, do not append.

**ItemList name fields:** Must use the full product title from the Shopify feed. Never use badge labels ("Best Value", "Entry Pick") or category descriptors as ItemList names.

---

### 4. Brand Logo Lookup

A complete brand logo CSV is available at `PPW_Brand_Logos.csv` containing 70 brands with their Shopify CDN image URLs. When generating a brands section for any collection page, the generator should:

1. Identify the vendors in the collection from the Shopify product feed
2. Look up each vendor name in `PPW_Brand_Logos.csv`
3. Use the matching CDN URL as the `<img src>` in the brand tile
4. If no match is found, use the striped placeholder

---

### 5. Ownership Section H3 Headings — Conditional

The generator must check the Shopify product type field from the feed before writing the ownership section headings. Do not use price as the determining factor.

**Equipment variant** (product types: Sauna, Sauna Heater, Hyperbaric Chamber, Cold Plunge, Gym Equipment, Cardio Equipment, Water Ionizer, or similar):
- Shipping and Freight
- Setup and Installation
- Care and Maintenance

**Accessory variant** (product types: Sauna Accessory, Recovery Tool, or any accessory category):
- Warranty and Support
- Care and Cleaning
- Returns

---

### 6. Pre-Publish Validation — Confirm Five Checks Are Running

All five checks must run against the generated HTML before the Shopify write call fires. Any failure holds the output.

1. Exactly one `<script type="application/ld+json">` tag
2. Exactly one `id="faq"` attribute
3. Every price in the HTML matches current `variants[0].price` from the live Shopify feed
4. Q1 and Q2 answer text does not contain any substring from the previous Q1 or Q2 question text
5. Every product handle in featured tiles and ItemList exists in the live Shopify product list

---

### 7. Section Order — Updated

Category collection pages (with all preserved elements):

1. Sticky navigation
2. Overview
3. FAQ
4. Quiz CTA — if found in preserved elements
5. Featured Products — always generated from Shopify feed
6. Sub-collection navigation tiles — if found in preserved elements
7. Learning Center — if 3 or more topically relevant blog posts exist
8. Buying Guide
9. Compare Table — if median price qualifies (see rule above)
10. Key Benefits
11. Space and Placement
12. Ownership / Delivery / Care
13. Schema block

---

## Updates to PPW_Brand_Collection_Page_Rules.md

---

### 1. Compare Table

**Confirmed:** Compare table always stays on brand collection pages regardless of price. No change to this rule.

---

### 2. Sub-Collection Navigation Tiles

**New rule (same as category pages):** Sub-collection navigation tiles on brand collection pages are preserved elements. Extract before generation, reinsert after featured products, preserve exactly.

---

### 3. CTA Button Text

**Same update as category pages:** "View [Short Model Name] ›" is acceptable for brand pages in addition to "View Product Details →". Brand pages have more product-specific context that makes model-name CTAs natural.

---

## New Files Created Today

**PPW_Brand_Logos.csv** — 70 PPW brands with Shopify CDN logo URLs pulled live from peakprimalwellness.com/pages/brands. Use for brand tile `<img src>` in collection page brands sections. Match on Brand Name column against vendor names from the Shopify product feed.

---

## Status of Live Pages Tested Today

| Collection | Template | Score | Action Needed |
|---|---|---|---|
| Sauna Buckets & Ladles | New template, live | 8.5/10 | Fix buying guide cards 1 and 3 (2 bullets each, need 3). Fix 2 mismatched learning center links. |
| Sauna Heaters | Old template, live | Not scored | Needs full generation with new template |
| Hybrid Saunas | New template, live | 9/10 | Minor: ItemList entries missing name fields |
| Ultra-Low EMF Saunas | New template, live | 7/10 | Tasks 6, 9, 11 still failing. Two unstyled duplicate sections need removal. |
| Barrel Saunas | Old template (patched), live | 5.5/10 | Needs full rewrite with new template |
