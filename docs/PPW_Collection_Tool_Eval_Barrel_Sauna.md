# PPW Collection Optimization Tool — Barrel Sauna Evaluation
## What's Working vs. What Needs Fixing

Tested against the barrel saunas collection page.
Before score: 4/10. After score: 5.5/10.
This document is for improving the generation logic.

---

## What the Tool Got Right

**Care section restructuring.**
The tool correctly replaced the single prose paragraph with three H3 subsections (Cleaning and Daily Care, Routine Maintenance, Warranty Coverage), each with bulleted lists. Content quality was strong — brand-specific warranty details for SaunaLife, Finnmark, and Golden Designs, specific maintenance timelines and actions. This is the rule being followed correctly.

**Key benefits expanded to proper depth.**
New benefit cards have 3 to 4 sentences each, include specific product model callouts, brand names, and category keywords within the copy. A significant improvement over the one-line originals.

**Buying guide specificity improved.**
New buying guide cards reference specific models by name in context rather than generic size/heat/shell categories. The right direction.

**Em-dash removed from FAQ question text.**
"Electric vs wood-fired, what should I pick?" — the em-dash was removed. Small fix, correctly applied.

**Two new FAQ questions added with good content.**
Total cost of ownership (with real price ranges from product data) and session length with safety guidance. Both matched in schema. Content quality was high.

**Schema sync maintained.**
The two new FAQ questions appeared in both the visible HTML and the FAQPage schema. The tool is correctly keeping these in sync when it adds new questions.

---

## What the Tool Got Wrong

### Critical — Blocks Publishing

**Appended new sections instead of replacing old ones.**
The tool added new `<section class="ppw-buying-guide">`, `<section class="ppw-key-benefits">`, and `<section class="ppw-care">` blocks at the bottom of the page. The original styled versions of those sections were still in the HTML above them. The page now has:
- Two buying guide sections
- Two key benefits sections
- Two care sections

None of the new sections have corresponding CSS. They will render completely unstyled. The page cannot be published as-is.

**Fix needed in generation logic:** The tool must replace each section entirely — locate the existing section by its `id` attribute and overwrite it. Never append below existing content.

**New FAQ questions use wrong HTML structure.**
The two new questions were added in a `<div class="ppw-faq-list">` using `<details class="ppw-faq-item">` and `<summary class="ppw-faq-question">` — different class names from the main FAQ's `.faq-modern .item` structure. These will not inherit the styled accordion behavior and will look visually broken.

**Fix needed:** New FAQ questions must use the same HTML structure as existing questions — `<div class="item"><details><summary><span>...</span><span class="chev"></span></summary><div class="body">...</div></details></div>` — inserted inside the existing FAQ section, not appended in a separate container below it.

---

### High Priority — SEO Impact

**H2 not updated.**
"Barrel Saunas — Iconic Outdoor Heat, Compact Footprints" was not changed. No keyword, no brand name, no price anchor. The rule requires the first H2 to contain the primary or secondary target keyword in the format `[Keyword Variant] — [Differentiator]`.

Should be something like: `Outdoor Barrel Saunas for Sale — SaunaLife Ergo Series from $4,390`

**Overview intro paragraph not touched.**
Same three sentences as before. No brand name in the first two sentences, no price anchor, the installation tip sentence remains. All three intro paragraph rules failed.

**Overview bullet points not updated.**
Still four bullets with no prices. None of the six required slots (entry product with price, premium option with price, certification signal, athletic use case, wellness use case, support differentiator) were filled. The tool did not touch this section at all.

**FAQ Q1 and Q2 still wrong.**
Q1 is still "Why choose a barrel sauna over a cabin?" — educational, not commercial intent.
Q2 is still "How many people fit in a barrel sauna?" — sizing question, not brand comparison.

The two required commercial questions were added as Q13 and Q14 rather than replacing Q1 and Q2. The rule says first two questions must be: "What is the best barrel sauna?" and a brand comparison question ("How does SaunaLife compare to other barrel sauna brands?").

**Fix needed:** Tool must identify Q1 and Q2 specifically and replace them, not just append commercial questions at the end.

**BreadcrumbList schema still missing.**
Not added. Required on every collection page. Must be inside the single `@graph` block alongside FAQPage and ItemList.

**Learning Resources section still absent.**
No "Complete Barrel Sauna Learning Center" section was generated. No pillar page card, no cluster blog post links. This is a required section on every collection page and was completely skipped.

---

### Medium Priority — Conversion Impact

**Product tiles have no prices and no CTA buttons.**
The four product tiles in the Barrel Types section still show only model name and a one-line description. No prices, no "View Product Details →" button. This was not touched. Prices must be pulled from product data and displayed on each tile. CTA button is required on every product card.

**Compare Options table still present alongside the new buying guide.**
The rule is one or the other — never both. The page now has the original comparison table AND the new buying guide section, plus the old buying guide section. Three overlapping commercial navigation sections.

---

## Schema-Specific Issues

**Double FAQPage schema block present.**
The two new FAQ questions appear in a separate `<script type="application/ld+json">` tag with only `@type: FAQPage` rather than being merged into the existing `@graph` block. The page now has two FAQPage schema declarations. Google will flag this.

**Fix needed:** All schema must exist in a single `@graph` block. When adding new FAQ questions to schema, the tool must update the existing FAQPage mainEntity array — not create a new script tag.

**Single @graph rule:**
One `<script type="application/ld+json">` tag per page containing:
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
Nothing else. No separate schema tags anywhere on the page.

**Note on Shopify auto-generated schema:**
Shopify themes may auto-generate `CollectionPage` and `BreadcrumbList` schema. Before publishing, check page source for how many `application/ld+json` script tags exist. If Shopify is already generating `BreadcrumbList`, omit it from the custom schema block to avoid duplication. Shopify does not auto-generate `FAQPage` or `ItemList` — these are safe to add without conflict.

---

## Root Cause Summary

The tool is generating additions rather than targeted replacements. Sections that needed updating were left in place and new versions were appended below them. This creates duplicate content, unstyled HTML, and broken schema.

**The one constraint that would fix most of these failures:**

> The tool must output complete section replacements, not appended additions. For every section that exists on the page, locate it by `id` and overwrite it entirely. Never create a new section with a different class name to replace the functionality of an existing one.

---

## Fixes Needed in the Generation Prompt

In priority order:

1. Output complete section replacements, not appended HTML
2. New FAQ questions must use the existing `.faq-modern .item` structure and be inserted inside the existing FAQ section
3. All schema must merge into the single existing `@graph` block — never add a new script tag
4. Q1 and Q2 must be replaced with commercial intent questions, not appended at the end
5. H2 must be rewritten to include the target keyword
6. Overview intro must be rewritten with brand names in first two sentences and a price anchor
7. Overview bullets must be expanded to six slots with prices
8. BreadcrumbList must be added to the @graph block
9. Product tiles must include prices (from product data) and a CTA button
10. Learning Resources section must be generated if missing — not skipped
11. Compare Options table must be removed when a buying guide is present
