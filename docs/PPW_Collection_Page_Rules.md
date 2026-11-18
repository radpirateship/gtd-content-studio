# PPW Collection Page Optimization Rules

Rules for the collection page generation component of the blog content app.
Each rule is marked as **Universal** (applies to every collection) or **Conditional** (applies only in specified circumstances).

---

## Pre-Generation Gate

**Universal**

Before generating or optimizing a collection page, check the active product count for that collection.

| Product Count | Action |
|---|---|
| Under 10 | Do not generate. Flag for product expansion first. |
| 10 to 20 | Generate with a depth warning noted in output. |
| 20 or more | Generate with no flag. |

This gate prevents link-building budget being directed at collections too thin to compete.

---

## Title and H1

**Universal**

The Shopify collection title becomes the page H1. It must contain the primary target keyword in its commercial form.

- "Hyperbaric Chambers for Sale" not "Hyperbaric Chambers"
- "Outdoor Saunas for Sale" not "Outdoor Saunas"
- "Barrel Saunas for Sale" not "Barrel Saunas"

The exact-match commercial keyword leads the title. Nothing comes before it.

---

## Meta Title

**Universal**

Format: `[Primary Keyword] | [Secondary Signal]`

- Hard limit: 60 characters including spaces
- Primary keyword comes first, always
- Secondary signal is either the dominant subcategory ("Home & Portable HBOT") or "Peak Primal Wellness" — whichever adds more informational value for that category
- Never mirror the collection title verbatim without the pipe separator and secondary signal
- Never let Shopify auto-generate this field

---

## Meta Description

**Universal**

- 150 to 160 characters
- Lead with the primary keyword or a close variant
- Include a price anchor ("from $X,XXX")
- Name at least one brand carried
- End with a commercial call to action ("Shop with free expert guidance" or similar)
- Never auto-generated from the first sentence of the collection description

---

## First H2 in Description Body

**Universal**

Must contain the primary or secondary target keyword.

Format: `[Keyword Variant] — [Differentiator]`

The differentiator must be a genuine buying reason: brand names, price anchor, or a unique support claim. Not generic copy ("the best selection available").

The em-dash is the only place it is used in a standard collection page — as a subheading separator in this H2 only.

---

## Overview Intro Paragraph

**Universal**

Three rules apply to every collection intro paragraph.

1. Name the brands carried within the first two sentences. Brand names establish category authority and capture brand-specific searchers.
2. Include a price anchor ("starting at $X,XXX") in the first paragraph. This filters unqualified traffic early.
3. No generic filler sentences. Every sentence must carry at least one of: a brand name, a keyword, a price point, a feature, or a trust signal. If a sentence carries none of these, cut it.

Prices in the intro must be pulled from live product data at generation time, not hardcoded.

---

## Overview Bullet Points

**Universal**

- Maximum six bullets
- Each bullet leads with a bolded label followed by a colon. No em-dashes as label separators
- No bullet starts with a generic adjective ("Premium," "High-quality," "Exceptional")
- No em-dashes anywhere inside bullet text

The six bullets should cover these six slots in order. The specific content varies by collection but the slot structure is fixed:

1. Entry-level product type with price anchor
2. Premium or high-spec product type with price anchor
3. Certification or regulatory signal (FDA-cleared, UL-listed, CE-certified, etc.)
4. Athletic or performance use case
5. Wellness or longevity use case
6. Support or service differentiator

---

## FAQ Section

**Universal**

- Minimum 12 questions, maximum 14
- Positioned immediately after the Overview section, before Featured Products
- Every question visible on the page must have a matching entry in FAQPage schema with identical question text

**First two questions are always commercial intent and category-specific:**

1. "What is the best [primary collection keyword]?" — this covers the highest-value buying-stage query for the category
2. A brand comparison question: "How does [Brand A] compare to [Brand B] and [Brand C]?" — populated with the actual brands carried in that collection

**Remaining 10 to 12 questions cover these topics (order flexible by category relevance):**

- What is a [product] used for?
- How much does a [product] cost?
- Is a [product] safe?
- What are the main types or formats available?
- How often should I use one?
- What accessories or additional equipment are needed?
- Do I need a prescription, permit, or professional installation?
- How much space is required?
- What health conditions or goals does it address?
- How long does a session / setup / installation take?
- Is it suitable for someone with [common concern, e.g. claustrophobia, limited mobility, small home]?
- Can multiple people use it / share it?

---

## Schema: FAQPage

**Universal**

- Must be present on every collection page
- Question text in schema must exactly match the visible question text on the page — no paraphrasing
- Schema answers should be condensed (under 200 words each) even if the visible answer is longer
- Never include a question in schema that does not appear visibly on the page, and never show a visible question that is not in schema

---

## Schema: ItemList

**Universal**

- Must reference exactly the four products shown in the Featured Products section
- Same four products, same order, same URLs
- URLs must be verified against live product handles at generation time
- Never use a handle ending in `-copy`, `-1`, `-2`, or any duplication suffix — if one is detected, flag it and require a clean handle before publishing
- ItemList name field: "Featured [Collection Name] at Peak Primal Wellness"
- If featured products change, schema updates at the same time — these must never be out of sync

---

## Schema: BreadcrumbList

**Universal**

- Must be present on every collection page
- Two items only:
  - Position 1: "Home" at `https://peakprimalwellness.com`
  - Position 2: The collection name at the full collection URL
- The collection name in the breadcrumb must match the H1 exactly

---

## Featured Products Section

**Universal**

- Exactly four products per collection page
- Each product represents a distinct buyer tier: entry value, mid-range, large or comfort-focused, and highest-spec or premium option
- Each card includes a badge naming the specific reason to choose it ("Best Entry Value," "Most Spacious," "Best Hard Shell") — not generic superlatives
- Prices pulled from live product data at generation time — never hardcoded
- Image URLs pulled from live product data at generation time
- Product handles verified as live and non-duplicate before use
- CTA button text is always "View Product Details →" — not "Shop Now," "Buy," or "Add to Cart"

---

## Price Accuracy

**Universal**

Prices displayed anywhere on a collection page (overview bullets, featured cards, buying guide, any comparison element) must match the live Variant Price field from product data.

- App should pull prices dynamically or flag a staleness warning if product data is older than 30 days
- Price drift is the most common source of collection page errors over time and must be caught at generation, not discovered manually

---

## Shipping Claims

**Universal**

Never include blanket "free shipping" language in collection page copy. Shipping terms vary by product weight class and carrier arrangement.

- The delivery section may describe the shipping process accurately ("ships via freight carrier with 2 to 4 week delivery timelines") without making a cost claim
- If free shipping is confirmed for a specific collection, it may be stated in the delivery section only — not in the overview, bullet points, or intro paragraph

---

## Em-Dash Rule

**Universal**

One acceptable use: the first H2 subheading, where it separates the keyword phrase from the differentiator.

Not used in:
- Bullet point label separators (use colons)
- Product descriptions
- FAQ answers
- Buying guide copy
- Benefits copy
- Care section copy
- Price ranges in body copy (use "to": "$4,495 to $21,995")

Price ranges in tables may use the en-dash format ("$4,495–$21,995").

---

## Care and Warranty Section

**Universal**

Structured into three subsections with H3 headings. Never written as a prose paragraph.

1. **Cleaning and Daily Care** — bulleted list, maximum five bullets
2. **Routine Maintenance** — bulleted list, maximum five bullets
3. **Warranty Coverage** — bulleted list, maximum five bullets

Adjacent to the care card: three quick links styled as cards or buttons pointing to Shipping, Returns, and Contact Us pages.

---

## Learning Resources / Content Hub

**Universal**

Links to a minimum of four supporting blog posts or guide pages.

- One featured card for the category pillar page or ultimate guide, displayed at full width with a CTA button. Label: "Complete [Category Name] Learning Center"
- Three cluster cards for supporting blog posts
- Cluster card headlines must match the actual published page title of the linked post — no paraphrasing that creates a mismatch between the anchor text and the destination H1
- Section heading is always: "Complete [Category] Learning Center" — not "Resources," "Guides," or "Learn More"
- If fewer than four supporting blog posts exist for a collection, flag this in the output as a content gap before publishing

---

## Buying Guide

**Universal**

Three cards. No more, no fewer.

- Card headings are action-oriented and follow the format: verb + noun ("Define Therapy Goals," "Assess Space and Budget," "Select Features and Brand")
- Each card contains exactly three bullet points
- Bullet labels are bolded and end with a colon
- No em-dashes inside bullet copy
- This section replaces any comparison table — do not include both on the same page

---

## Key Benefits

**Universal**

Four cards. Each card contains:
- An emoji icon
- A bolded H3 heading naming the outcome, not the feature ("Accelerated Recovery" not "Increased Oxygen Delivery")
- A paragraph of three to four sentences
- At least one mention of the product category by name within the paragraph (maintains keyword density in lower-page content)

---

## Social Proof / Testimonials

**Conditional — only if verified reviews exist**

- Never publish placeholder or fabricated testimonials
- If real verified reviews are not available, omit the section entirely and create a ClickUp task to source them before the next content update
- When reviews are added: three cards, five stars only
- Each card shows: customer first name and last initial or city/state, the specific product model purchased, a quote of two to four sentences
- No generic superlatives in the quote text ("amazing," "life-changing," "incredible")
- Reviews must be from actual purchasers of products in that collection — not general brand praise

---

## Internal Links (Incoming — Tracking Only)

**Universal**

Every collection page should have a minimum of three blog posts linking to it with partial-match anchors. The app should flag if a collection's tracked internal link count falls below three.

Anchor text rules for internal links pointing to a collection page:
- Maximum four words per anchor
- No more than 35 percent exact-match anchors across all internal links to that page
- Same distribution rules as paid external links

---

## ROI / Break-Even Section

**Conditional — high-ticket categories only**

Do not include in standard collection page generation.

Add only when all three of the following are true:
1. The collection's average order value exceeds $3,000
2. The purchase replaces an ongoing service cost the buyer is likely already paying (clinical HBOT sessions, spa sauna memberships, cryotherapy clinic visits)
3. The category ultimate guide does not already contain a break-even calculation — if it does, link to the guide from the collection page rather than duplicating the content

Candidate collections as of 2026: hyperbaric chambers, saunas, cold plunges.

When included:
- Three cards representing entry, mid-range, and premium price points
- Each card shows: product name, break-even session count (price divided by the category-specific average service cost, not a generic figure), realistic break-even timeline at a stated weekly frequency, and year-one savings versus the service alternative
- Footer note below the cards states the assumption used for the cost-per-session figure
- Calculation inputs are category-specific — never reuse a generic template across categories

---

## General Formatting Rules

**Universal**

Banned phrases — flag and replace at generation:
- "straightforward"
- "honestly"
- "genuinely"
- "seamlessly"
- "elevate your"
- "dive into"
- "delve into"
- "comprehensive solution"
- "we are committed to"
- "Whether you are X or Y, we have you covered"
- Any sentence beginning with "Discover"

Structural rules:
- Colons as label-to-content separators in bullet points throughout — not dashes, not em-dashes
- Oxford comma applied consistently within each section
- "to" for ranges in body copy — "1.3 to 1.5 ATA," "$4,495 to $21,995"
- En-dash acceptable in table cells for ranges only
