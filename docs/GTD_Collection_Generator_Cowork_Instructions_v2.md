# GTD Collection Page Generator — Cowork Instructions

## Two Modes

**Generate** — Full rewrite from scratch using live Shopify product data, Ahrefs keyword research, and the appropriate template rules. This is the primary mode for all collection pages going forward.

**Improve** — The legacy patch mode that edits existing HTML using the 14-task checklist. Retired for most collections. Only use Improve if a page already scored 8 or above on the 14-task audit and needs minor fixes rather than a full rewrite.

---

## Collection Type Detection

Before anything else, identify which template to use.

Pull the product list from the Shopify API:
```
GET /admin/api/2024-01/collections/{collection_id}/products.json
  ?limit=250&fields=id,title,handle,images,variants,vendor
```

Count unique vendors in the result.

- **One vendor:** Use the Brand Collection template rules (GTD_Brand_Collection_Page_Rules.md)
- **Multiple vendors:** Use the Category Collection template rules (GTD_Collection_Page_Rules.md)
- **Product count under 10:** Flag as too thin and pause. Do not generate until product depth issue is resolved.

---

## Preserved Elements Extraction

Before overwriting any existing page, scan the current HTML for three elements that must be carried forward if present. These are treated the same way — extract, preserve exactly, reinsert at the correct position in the generated output. Never rewrite, restructure, or remove them.

**Learning Center blog post URLs**
Look for anchor tags inside `.gtd-cluster-card` elements or any section with id containing "resources" or "learning". Extract each href and its H4 headline text. Store as a list of `{url, title}` pairs.

If fewer than three blog post URLs are found, note this as a content gap in the output. The Learning Center section will be omitted from generation until content exists.

**Quiz CTA block**
Look for a gradient div or section linking to `/pages/sauna-quiz` or `/pages/hyperbaric-quiz` or any `/pages/*-quiz` URL. Extract the full block HTML including heading, description paragraph, and button link.

If found, this block is injected between the FAQ section and the Featured Products section in the generated output.

**Sub-collection navigation tiles**
Look for `.gtd-type` tiles or any grid of linked tiles where the `href` values point to `/collections/` URLs rather than `/products/` URLs. These are sub-collection navigation elements, not product tiles. Extract the entire section including its heading, section id, and all tile HTML.

If found, preserve and reinsert the section exactly as it appears in the existing page. Place it immediately after the Featured Products section. The corresponding nav link must also be preserved.

Sub-collection navigation tiles must never be removed, restructured, or used as a substitute for the featured products section. They serve a different purpose — helping buyers navigate between related collections — and coexist with the featured products section on the same page. If a page has sub-collection tiles but no featured product tiles, both need to exist in the generated output: featured products added new from the Shopify feed, sub-collection tiles preserved from the existing page.

---

## Step 1 — Ahrefs Keyword Research

Run this before writing a single word of page content. The keyword data directly shapes H1, meta title, H2, overview intro, and FAQ Q1.

**1a — Primary keyword overview**
Call `keywords-explorer-overview` with the most obvious commercial query for the collection (e.g. "low emf saunas for sale", "hyperbaric chambers for sale", "outdoor saunas for sale").

Extract:
- `volume` — monthly search volume
- `difficulty` — keyword difficulty score
- `traffic_potential` — estimated traffic to #1 ranking page across the full topic cluster

**1b — SERP overview**
Call `serp-overview` for the same primary keyword.

Extract:
- The top 10 ranking URLs and their domain ratings
- Any patterns in how competitors phrase their titles and H1s
- Whether any GTD pages are already ranking

**1c — Related and matching terms**
Call `keywords-explorer-matching-terms` with 2 to 3 seed terms for the collection.

Extract the top 15 to 20 results by volume. From these, identify:
- **Primary keyword:** The highest-volume commercial intent term. This becomes the H1 anchor.
- **Secondary keywords:** 3 to 5 variants with meaningful volume that can be worked into the H2, bullets, and buying guide headings.
- **Long-tail questions:** Any question-format keywords (how, what, which, best) that can become FAQ questions Q3 through Q12.

**1d — Keyword injection map**
Before writing content, create an explicit mapping of where each keyword will appear:

| Location | Keyword to use |
|---|---|
| Shopify collection title (H1) | Primary keyword + "for sale" if commercial |
| Meta title | Primary keyword + secondary signal |
| Meta description | Primary keyword + price anchor + brand names |
| First H2 | Keyword variant + differentiator |
| Overview intro sentence 1 | Brand names + price anchor |
| Overview intro sentence 2 | Primary or secondary keyword naturally |
| FAQ Q1 question | "What is the best [primary keyword]?" |
| Buying guide card 3 heading | Secondary keyword variant as verb phrase |
| Benefits paragraphs | Category name at least once per card |

Do not proceed to generation until this map is complete.

---

## Step 2 — Product Selection for Featured Section

From the full product list pulled in the type detection step, select four products for the featured section.

**Selection logic:**
Sort all products by `variants[0].price` ascending. Select:
- Position 1: Lowest-priced product (entry value)
- Position 2: Price between entry and midpoint (mid-range)
- Position 3: Price between midpoint and top (large or comfort-focused)
- Position 4: Highest-priced product (premium or highest-spec)

**Tie-breaking when multiple products share a price:**
Differentiate by capacity (person count) first, then by feature set (full-spectrum vs FAR, chromotherapy, etc.).

**For each selected product, capture:**
- `handle` — for the product URL
- `title` — for the card name
- `images[0].src` — for the tile image
- `variants[0].price` — for the price badge
- `vendor` — for the one-line description context

---

## Step 3 — Generate the Page

Generate each section in order. Use the keyword injection map and product data from Steps 1 and 2. Reference the appropriate rules MD file for every section's structure, slot requirements, and format constraints.

### Section order for category collection pages:

1. Sticky navigation
2. Overview (H2 + intro paragraph + six bullets + image)
3. FAQ (12 to 14 questions, `.faq-modern` accordion format)
4. Quiz CTA block — inject here if one was found in preserved elements extraction
5. Featured Products (four `.gtd-type` tiles with prices and CTA buttons, always generated from Shopify feed)
6. Sub-collection navigation tiles — inject here if found in preserved elements extraction, preserving the section exactly
7. Learning Center — inject here if three or more blog URLs were found
8. Buying Guide (three cards, action-verb headings, three bullets each)
9. Key Benefits (four cards, outcome headings, 3 to 4 sentence paragraphs)
10. Space and Placement (table)
11. Delivery Path (three cards)
12. Care, Warranty and Shipping (three H3 subsections with bullets)
13. Schema block

### Section order for brand collection pages:

1. Sticky navigation
2. Overview (H2 + intro paragraph + six bullets + image)
3. FAQ (12 to 14 questions, `.faq-modern` accordion format)
4. Quiz CTA block — inject here if found
5. Featured Products (four to eight `.gtd-type` tiles with prices and CTA buttons)
6. Learning Center — inject here if three or more blog URLs were found
7. Compare Table (keep for brand pages — do not remove)
8. Key Benefits (four cards)
9. Space and Placement (table)
10. Delivery Path (three cards)
11. Care, Warranty and Shipping (three H3 subsections with bullets)
12. Schema block

---

## Step 4 — Schema Generation

Generate a single `<script type="application/ld+json">` block containing one `@graph` array with all types for the page. Never create separate script tags.

**For category collection pages, @graph contains:**
```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "BreadcrumbList", ... },
    { "@type": "FAQPage", ... },
    { "@type": "ItemList", ... }
  ]
}
```

**For brand collection pages, @graph contains:**
```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "BreadcrumbList", ... },
    { "@type": "FAQPage", ... },
    { "@type": "ItemList", ... },
    { "@type": "Brand", ... }
  ]
}
```

**FAQPage:** Every visible FAQ question and answer must appear here with identical question text. Never include a question in schema that is not visible on the page.

**ItemList:** Must reference exactly the four products shown in the featured section using their full product URLs and proper product names (not badge labels or category descriptors). Include `offers` data with price and currency.

**BreadcrumbList:** Two items only. Position 1 is Home. Position 2 is the collection name matching the H1 exactly.

**Brand (brand pages only):** Name, URL, and a 2 to 3 sentence description. Do not use the GTD logo as the brand logo.

---

## Step 5 — Pre-Publish Validation

Run all five checks against the generated HTML before firing the Shopify write call. Any failure is a hard blocker — hold output and surface the specific error. Do not publish until all five pass.

**Check 1 — Single schema tag**
Count occurrences of `<script type="application/ld+json">` in the output. Must equal exactly 1.

**Check 2 — No duplicate section IDs**
Scan for any `id` attribute that appears more than once. Flag each duplicate. Common culprits: `id="faq"`, `id="featured"`, `id="benefits"`.

**Check 3 — Price accuracy**
Every price displayed in the HTML (badges, overview bullets, buying guide bullets, compare table) must match the current `variants[0].price` from the live product feed pulled in Step 2. Flag any mismatch with the displayed price and the actual price side by side.

**Check 4 — Q1 and Q2 answer integrity**
Confirm that the text content of FAQ Q1 and Q2 answers does not contain any substring that matches the previous Q1 or Q2 question text from the original page. This catches content bleed from the replacement operation.

**Check 5 — Product URL validity**
Every product handle used in the featured tiles and ItemList schema must exist in the product list pulled from the Shopify API. Flag any handle that does not match a live product.

---

## Step 6 — Shopify Publish

On clean validation pass, write the generated HTML to the collection description field via the Shopify API:

```
PUT /admin/api/2024-01/collections/{collection_id}.json
{
  "collection": {
    "id": {collection_id},
    "body_html": "{generated_html}"
  }
}
```

Also update the collection title (H1), meta title, and meta description in the same call using the SEO fields if the Shopify API version supports it. If not, flag these three fields for manual update in Shopify admin with the exact strings to use.

---

## Keyword Research Output — What Goes in the Page vs. What Goes in a Log

Not all Ahrefs data belongs on the page. Some of it is strategic context for the link building plan.

**Goes into the page:**
- Primary keyword in H1, meta title, H2
- Secondary keywords in overview bullets and buying guide headings
- Long-tail question variants as FAQ questions Q3 through Q12
- Traffic potential noted internally to inform whether this collection is a link building priority

**Goes into a logged output (not the page):**
- Keyword difficulty score
- Current GTD ranking position for the primary keyword from the SERP overview
- Top 3 competing domains and their domain ratings
- Any keywords where GTD is already ranking in positions 11 to 30 (quick win opportunities)

This logged output should be formatted as a brief summary block appended after the generated HTML so it's visible in the Cowork session but does not get written to Shopify.

---

## Collection Tier Reference

| Tier | Example Collections | Template | Preserve | Special Logic |
|---|---|---|---|---|
| Standard category | low-emf-saunas, cold-plunges, barrel-saunas | Category rules | Sub-collection tiles if present | Pure generation from product feed |
| Featured category | hyperbaric-chambers, saunas, outdoor-saunas | Category rules | Learning center URLs + quiz CTA + sub-collection tiles if present | Extract before generating |
| EMF sub-category | ultra-low-emf-saunas, near-zero-emf-saunas | Category rules | EMF tier navigation tiles + learning center URLs + quiz CTA | Sub-collection tiles always present, extract and reinsert after featured products |
| Brand | prx-performance, saunalife, oxyrevo | Brand rules | Sub-collection tiles if present | Keep compare table, add Brand schema |

---

## What to Do When the Shopify Feed Returns Fewer Than Four Products

If the collection has fewer than four products after filtering to active status, do not generate a four-tile featured section. Instead:

- Generate tiles for however many products exist
- Add a content gap note to the logged output: "Collection has [N] active products. Featured section contains [N] tiles. Recommend expanding product assortment before link building targeting."
- Flag in the pre-publish output that this collection should not be a primary link building target until product depth reaches 10 or more.
