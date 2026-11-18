# PPW Brand Collection Page Optimization Rules

Rules for brand-specific collection pages (e.g. PRX Performance, SaunaLife, OxyRevo, Finnmark).
These pages showcase a single brand's full product lineup rather than a product category.

Where a rule is identical to the category collection rules, it is marked **Same as category template**.
Where a rule differs, it is marked **Brand-specific** with the reason.

---

## What Makes a Brand Collection Page Different

Brand collection pages exist to surface a vendor's full range and help buyers navigate between product lines within a brand. The buyer intent is "I know I want [Brand] — help me find the right model" rather than "I'm shopping a category across multiple brands."

This changes three things structurally:

1. Compare tables stay. They are the primary navigation tool for a brand lineup. A 3-card buying guide does not replace them.
2. FAQ questions are brand-specific, not category-generic.
3. The ItemList schema may cover more than four products since the goal is brand discovery, not a curated 4-product featured set.

---

## Pre-Generation Gate

**Same as category template**

Check active product count in the brand collection before generating.

| Product Count | Action |
|---|---|
| Under 5 | Do not generate. Flag as too thin for a brand collection page. |
| 5 to 10 | Generate with a depth warning. |
| 10 or more | Generate with no flag. |

---

## Title and H1

**Brand-specific**

The Shopify collection title becomes the H1. For brand collections it must contain the brand name and a product category descriptor.

Format: `[Brand Name] [Product Category]`

Examples:
- "PRX Performance Home Gym Equipment" not "PRX Performance"
- "SaunaLife Outdoor Saunas" not "SaunaLife"
- "OxyRevo Hyperbaric Chambers" not "OxyRevo"

The brand name leads. The category descriptor orients the buyer and provides keyword signal.

---

## Meta Title

**Brand-specific**

Format: `[Brand Name] [Product Type] | Peak Primal Wellness`

Hard limit: 60 characters.

Examples:
- "PRX Performance Home Gyms | Peak Primal Wellness"
- "SaunaLife Outdoor Saunas | Peak Primal Wellness"

Leads with brand name since brand-aware searchers are the primary audience for these pages.

---

## Meta Description

**Same as category template structure, brand-specific content**

150 to 160 characters. Lead with the brand name. Include a price anchor referencing the entry-level product. Name the primary product line. End with a commercial CTA.

Example: "PRX Performance wall-mounted folding racks, functional trainers, and accessories from $X,XXX. Professional-grade home gym equipment at Peak Primal Wellness."

---

## First H2 in Description Body

**Brand-specific**

Must contain the brand name and primary product type. Em-dash is acceptable here as a subheading separator.

Format: `[Brand Name] [Primary Product Type] — [Differentiator]`

Example: `PRX Performance Wall-Mounted Home Gyms — Folding Racks and Functional Trainers from $X,XXX`

The differentiator should name the key brand differentiator (folding mechanism, warranty, manufacturing origin, etc.) or a price anchor. Not generic copy.

---

## Overview Intro Paragraph

**Same rules, brand-specific content**

Three rules apply:

1. The brand name appears in the first sentence.
2. A price anchor ("starting at $X,XXX") appears in the first paragraph.
3. No filler sentences. Every sentence must carry a brand name, product line name, price point, feature, or trust signal.

Additionally for brand pages: name the primary product lines in the first two sentences (e.g. Profile series and Build Limitless series for PRX). This is the brand equivalent of naming the brands you carry on a category page.

---

## Overview Bullet Points

**Brand-specific slots**

Six bullets using bolded labels with colons. No em-dashes as label separators.

The six required slots for brand collection pages:

1. Entry product with specific model name and price
2. Premium or flagship product with specific model name and price
3. Brand certification or manufacturing signal (made in USA, ETL listed, CE certified, etc.)
4. Primary athletic or performance use case
5. Lifestyle or home setup use case
6. Brand support or warranty differentiator

The difference from category pages: slots 1 and 2 reference specific model names (e.g. "Profile ONE Squat Rack at $X,XXX") rather than product types. Buyers on brand pages expect model-level specificity.

---

## FAQ Section

**Same structure, brand-specific Q1 and Q2**

Minimum 12 questions, maximum 14. Positioned after the overview. Every visible question must have a matching FAQPage schema entry with identical question text.

**Q1 — always:** "What is the best [Brand Name] [primary product type]?"
Answer should recommend 2 to 3 specific models with brief rationale. Naming models in Q1 is expected and appropriate for brand pages.

**Q2 — always:** "How does [Brand Name] compare to [Competitor Brand A] and [Competitor Brand B]?"
Answer should give a genuine, honest comparison covering the key differentiators. Do not write marketing copy — write the comparison a buyer researching alternatives would find useful.

**Remaining 10 to 12 questions should cover:**
- What is included with [primary product]
- What wall type or installation is required
- What is the weight capacity or load rating
- What are the space or ceiling height requirements
- Does [Brand] equipment work with standard barbells / plates / accessories
- Can equipment be expanded or upgraded over time
- What does the warranty cover and for how long
- How long does delivery take and what does shipping involve
- Can I install it myself or do I need a professional
- What is the return or trial period policy
- Are there financing options
- Is this suitable for [specific use case relevant to the brand category]

**FAQ accordion style:** Must use the `.faq-modern` structure with chevron toggles — not the `.ppw-faq` left `+/-` style. Brand collection pages must match the site-wide FAQ component for visual consistency.

---

## Schema: FAQPage

**Same as category template**

Single FAQPage block inside the @graph array. Question text must exactly match visible questions. Never include a question in schema that is not visible on the page.

---

## Schema: ItemList

**Brand-specific**

For brand collection pages, the ItemList should reference the products shown in the Featured Products section. If the page has a compare table with additional models not in the featured section, include those in the ItemList as well up to a maximum of 12 entries.

Each ListItem must include both `name` and `url`:
```json
{"@type":"ListItem","position":1,"name":"PRX Profile ONE Squat Rack","url":"https://peakprimalwellness.com/products/..."}
```

URL format: verify all product handles are live and correctly encoded. Special characters like ® must use percent-encoding (`%C2%AE`) in URLs, not the literal symbol.

ItemList name field: "[Brand Name] Products at Peak Primal Wellness"

---

## Schema: Brand

**Brand-specific — add this type, not present on category pages**

Include a `Brand` schema type in the @graph block for brand collection pages.

```json
{
  "@type": "Brand",
  "name": "[Brand Name]",
  "url": "https://peakprimalwellness.com/collections/[collection-handle]",
  "description": "[2 to 3 sentence brand description covering what they make and their key differentiator]"
}
```

Do not include a `logo` field unless you have the brand's actual logo URL. Do not use the Peak Primal Wellness logo as the brand logo — these are different entities.

---

## Schema: BreadcrumbList

**Same as category template**

Two items only:
- Position 1: "Home" at `https://peakprimalwellness.com`
- Position 2: The brand collection name at the full collection URL

The brand collection name in the breadcrumb must match the H1 exactly.

---

## Schema: Single @graph Block

**Same as category template**

One `<script type="application/ld+json">` tag containing all types in a single @graph array: FAQPage + ItemList + BreadcrumbList + Brand. Never create separate script tags.

---

## Featured Products Section

**Brand-specific**

The featured section on brand pages showcases the most important or best-selling models — typically 4 to 8 products, organized by product line or category using section dividers (e.g. "Wall-Mounted Racks" then "Accessories").

Each product tile must include:
- Product image
- Product name with model number or series name if applicable
- Price (pulled from live product data)
- Brief description (1 to 2 sentences on key differentiator)
- CTA button

**CTA button text for brand pages:** "View [Short Model Name] →" is acceptable in addition to the generic "View Product Details →." Brand pages have more product-specific context that makes model-name CTAs natural ("View Profile ONE →"). Both formats are permitted. The generic format must be used if there is no obvious short model name.

---

## Price Accuracy

**Same as category template**

All prices must be pulled from live product data at generation time. Never hardcode. Flag a staleness warning if product data is older than 30 days.

---

## Compare Table

**Brand-specific — keep it, do not remove it**

Brand collection pages use compare tables as the primary navigation tool for buyers choosing between models. Do not apply the "remove compare table if buying guide is present" rule from the category template.

Table structure:
- Image column (product thumbnail)
- Product name column
- Product type or series column
- Key highlights (3 to 4 bullet points or comma-separated features)
- Price column
- Shop column with linked CTA

If the brand has more than 8 products, organize by product line with a section divider heading between each group. Do not put all products in a single table — split by category (racks, accessories, weights, etc.).

Prices must appear in the compare table. A table without prices is incomplete.

---

## Buying Guide

**Brand-specific — conditional, not default**

For most brand collection pages, the compare table serves the buying guide function. A separate 3-card buying guide is only needed when the brand has multiple product lines that require different purchase decisions (e.g. "do I want a rack or a functional trainer" is a genuine decision that benefits from a 3-card guide).

If a buying guide is added:
- Same rules as category template: three cards, action-verb headings, three bullets per card, bold labels with colons
- Frame around product line decisions, not category-level decisions
- Place before the compare table, not after

---

## Key Benefits

**Brand-specific structure**

Four benefit cards following the same rules as the category template:
- Emoji icon
- H3 heading naming an outcome ("Reclaim Your Floor Space" not "Wall-Mounted Design")
- 3 to 4 sentence paragraph
- At least one mention of the brand name or a specific product line within the paragraph

The benefits section on brand pages should emphasize the brand's specific differentiators (e.g. PRX's folding mechanism, SaunaLife's Ergo-bench design, OxyRevo's pressure range) rather than generic category benefits.

A bullet list is not an acceptable substitute for benefit cards. Bullet lists must be converted to the 4-card format.

---

## Learning Resources / Content Hub

**Brand-specific — conditional**

Include if at least 3 blog posts about the brand exist on the site. Omit if fewer than 3 exist and add a content gap flag to the output.

When included, the section heading is: "Complete [Brand Name] Learning Center"

The pillar card links to the brand's ultimate buying guide or comparison article. Cluster cards link to brand-specific reviews, comparisons, or setup guides.

Cluster card headlines must match the actual published page titles of the linked posts — no paraphrasing.

---

## Shipping Claims

**Same as category template**

No blanket "free shipping" language. Reference the shipping process accurately without cost claims. Shipping details belong in the care section, not the overview.

---

## Em-Dash Rule

**Same as category template**

Permitted only in H2 subheadings as a separator. Not in bullet labels, FAQ answers, benefit cards, or care section. Colons for label-to-content separators throughout.

---

## Care and Warranty Section

**Same as category template**

Three H3 subsections with bullet lists:
1. Cleaning and Daily Care
2. Routine Maintenance
3. Warranty Coverage

For brand pages, the warranty coverage subsection must name the specific warranty terms for the brand's main product lines. "See product pages for warranty details" is not acceptable — the actual coverage period and what is covered must be stated if known.

Quick links to Shipping, Returns, and Contact Us remain as standard.

---

## Social Proof / Testimonials

**Same as category template**

Only include verified customer reviews. Never publish placeholder testimonials. If real reviews are not available, omit and create a ClickUp task to source them.

---

## General Formatting Rules

**Same as category template**

Banned phrases: "straightforward," "honestly," "genuinely," "seamlessly," "elevate your," "dive into," "delve into," "comprehensive solution," "we are committed to," "Whether you are X or Y, we have you covered," any sentence beginning with "Discover."

Colons for label-to-content separators. "to" for ranges in body copy. En-dash acceptable in table cells for ranges only.

---

## Brand Collection vs Category Collection — Quick Reference

| Element | Category Template | Brand Template |
|---|---|---|
| H1 format | "[Category] for Sale" | "[Brand] [Product Type]" |
| Meta title leads with | Primary keyword | Brand name |
| Intro Q1 names | Brands carried | Product lines within brand |
| Buying guide | Required | Conditional |
| Compare table | Remove if buying guide present | Always keep |
| ItemList count | Exactly 4 (featured products) | 4 to 12 (featured + compare) |
| Brand schema | Not included | Required |
| Benefits section | 4 outcome cards | 4 brand-differentiator cards |
| Learning Center | Required (4 posts) | Conditional (3+ posts) |
| CTA button text | "View Product Details →" | "[Model Name] →" acceptable |
| Warranty in care | General terms | Brand-specific terms required |
