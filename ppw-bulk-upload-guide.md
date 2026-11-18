# PPW Content Studio — Bulk Upload CSV Guide

## Quick Start

The CSV template has **13 columns**. Only the first 3 are required — the rest are optional and will use smart defaults if left blank.

| # | Column | Required | Default | Description |
|---|--------|----------|---------|-------------|
| 1 | `title` | ✅ Yes | — | Article title (wrap in quotes if it contains commas) |
| 2 | `keyword` | ✅ Yes | — | Primary SEO keyword to target |
| 3 | `collection` | ✅ Yes | — | Product collection (see list below) |
| 4 | `articleType` | No | auto | Content structure template |
| 5 | `audience` | No | general | Target reader persona |
| 6 | `tone` | No | authoritative | Writing voice |
| 7 | `wordCount` | No | 2500 | Target word count |
| 8 | `includeComparisonTable` | No | false | Add product comparison grid |
| 9 | `specialInstructions` | No | — | Custom editor notes for AI |
| 10 | `priority` | No | — | Queue ordering (P1/P2/P3) |
| 11 | `titleTag` | No | Auto-generated | Custom SEO title tag |
| 12 | `metaDescription` | No | Auto-generated | Custom meta description for SEO |
| 13 | `shopifySlug` | ⚡ Recommended | Auto-generated from title | Shopify blog URL slug |

> ⚠️ **`shopifySlug` must include the `/blogs/wellness/` prefix.**
> Correct: `/blogs/wellness/best-exercise-bike-for-home`
> Wrong: `best-exercise-bike-for-home`
>
> If omitted, the app auto-generates a slug from the title — which may not match your planned URL structure.

> ⚠️ **If `metaDescription` contains commas, wrap the entire value in double quotes.** Otherwise the CSV parser will split it across multiple columns and corrupt all fields after it.

---

## Column Details

### `collection` — Valid Values

These must match exactly (case-insensitive matching is applied):

| Collection Name | Maps To Slug | Hub Section |
|----------------|-------------|-------------|
| Infrared Saunas | `infrared-saunas` | Saunas |
| Saunas | `saunas` | Saunas |
| Barrel Saunas | `barrel-saunas` | Saunas |
| Sauna Heaters | `sauna-heaters` | Saunas |
| Sauna Accessories | `sauna-accessories` | Saunas |
| Steam | `steam` | Saunas |
| Cold Plunges | `cold-plunges` | Recovery |
| Red Light Therapy | `red-light-therapy` | Recovery |
| Hyperbaric Chambers | `hyperbaric-chambers` | Recovery |
| Massage Equipment | `massage-equipment` | Recovery |
| Compression Boots | `compression-boots` | Recovery |
| Sensory Deprivation Tanks | `sensory-deprivation-tanks` | Recovery |
| Hydrogen Water | `hydrogen-water` | Wellness |
| Water Ionizers | `water-ionizers` | Wellness |
| Air Filters | `air-filters` | Wellness |
| Elliptical Machines | `elliptical-machines` | Fitness |
| Exercise Bikes | `exercise-bikes` | Fitness |
| Treadmills | `treadmills` | Fitness |
| Stair Climbers | `stair-climbers` | Fitness |
| Vertical Climbers | `vertical-climbers` | Fitness |
| Pilates | `pilates` | Fitness |

> ⚠️ **Legacy names — do not use:** `Float Tanks` (use `Sensory Deprivation Tanks`), `Massage Chairs` or `Massage` (use `Massage Equipment`), `cold-plunge` singular (use `Cold Plunges`).

### `articleType` — Content Structure Templates

| Value | Use When | Maps From Excel "Type" / "Format" |
|-------|----------|-----------------------------------|
| `buyers-guide` | Product selection articles with criteria, recommendations | Pillar / Buyer's Guide |
| `comparison` | Side-by-side analysis (includes comparison table) | Comparison / Comparison Guide |
| `how-to` | Step-by-step instructions or tutorials | How-To Guide |
| `listicle` | Numbered items (Top 5, Top 10, etc.) | List / Listicle |
| `benefit-deep-dive` | Single benefit analysis with research backing | Deep Dive / Benefit-Focused |
| `brand-review` | Individual brand/product line review | Review / Brand Review |
| `ultimate-guide` | Comprehensive pillar content (3000+ words) | Pillar / Ultimate Guide |

### `audience` — Target Reader Persona

| Value | Description | Best For |
|-------|-------------|----------|
| `general` | No jargon, simple explanations | Informational intent articles |
| `enthusiast` | Technical language, protocols | Enthusiast-focused content |
| `athlete` | Performance metrics, recovery focus | Sports/fitness content |
| `first-time` | Address concerns, explain value | Commercial intent / buyer's guides |
| `professional` | Clinical terminology, studies | Professional/medical content |

### `tone` — Writing Voice

| Value | Description |
|-------|-------------|
| `educational` | Informative, approachable teaching style |
| `authoritative` | Expert voice, confident recommendations |
| `comparison` | Balanced, analytical comparison style |

### `includeComparisonTable`

Set to `true` for comparison and buyer's guide articles where a side-by-side product grid adds value. The AI will generate a PPW-styled comparison table within the article.

### `specialInstructions`

Free-text field for custom editor notes passed directly to the AI. Examples:
- `"Include clinical study references and dosing protocols"`
- `"Cross-reference sauna collection. Focus on contrast therapy protocol."`
- `"Target 'People Also Ask' questions from SERP"`
- `"Mention Black Friday pricing if applicable"`

### `priority`

For queue ordering when processing bulk uploads. The app processes P1 first, then P2, then P3.

| Value | Meaning |
|-------|---------|
| P1 | High priority — pillar content, high-volume keywords |
| P2 | Medium priority — supporting cluster content |
| P3 | Lower priority — long-tail, supplementary articles |

### `titleTag`

Custom SEO title tag for the article. If left blank, the app auto-generates one from the title and keyword. Useful when you want precise control over what appears in search results.

### `metaDescription`

Custom meta description for SEO. If left blank, the app auto-generates one from the AI-written subtitle (capped at 160 characters). Wrap in quotes if it contains commas.

### `shopifySlug`

The URL handle for the Shopify blog post. **Must include the `/blogs/wellness/` prefix.** The app strips the prefix internally to get the bare handle for Shopify, but expects the full path in the CSV for consistency with the Topical Authority spreadsheets.

If omitted, the app generates a slug from the article title using a basic regex (lowercase, hyphens for spaces). This often doesn't match the planned URL from your authority guide — always supply the slug from your spreadsheet.

---

## Mapping from Excel Topical Authority Plan

### Fields You Should Map

| Excel Column | CSV Column | Notes |
|-------------|------------|-------|
| Title | `title` | Required |
| Target Keyword | `keyword` | Required |
| Collection | `collection` | Required |
| Title Tag | `titleTag` | Optional — auto-generated if blank |
| Meta Description | `metaDescription` | Optional — quote if it contains commas |
| URL / Existing URL | `shopifySlug` | Recommended — must include `/blogs/wellness/` prefix |

### Fields the App Handles Automatically

These Excel columns do **not** need a CSV column:

| Excel Column | App Behavior |
|-------------|--------------|
| KW Search Volume | Not used in generation (planning-only field) |
| Created? / Action / Optimized? | Project management (not generation fields) |
| Notes | Use `specialInstructions` for editor notes that should influence content |
| Intent | Implied by `articleType` and `audience` choices |

### Recommended Mapping Strategy

| Excel "Intent" | → articleType | → audience |
|----------------|--------------|------------|
| Informational | benefit-deep-dive, how-to, ultimate-guide | general, enthusiast |
| Commercial | buyers-guide, comparison, listicle | first-time, general |
| Navigational | brand-review | enthusiast |

---

## Minimal CSV Example (3 columns only)

```csv
title,keyword,collection
"Best Infrared Saunas for Home Use",best infrared saunas,Infrared Saunas
"Cold Plunge Benefits for Recovery",cold plunge benefits,Cold Plunges
"Best Massage Equipment for Home",best massage equipment,Massage Equipment
"Best Compression Boots for Recovery",best compression boots,Compression Boots
```

The app will use these defaults: articleType=auto, audience=general, tone=authoritative, wordCount=2500. Slugs will be auto-generated from the title.

## Full 13-Column CSV Example

```csv
title,keyword,collection,articleType,audience,tone,wordCount,includeComparisonTable,specialInstructions,priority,titleTag,metaDescription,shopifySlug
"Best Infrared Saunas for Home Use 2025","best infrared saunas",Infrared Saunas,buyers-guide,first-time,authoritative,2500,true,,P1,Best Infrared Saunas for Home: Expert Picks,"Find the best infrared saunas for home use. Expert-tested picks compared by heat type, build quality, and value.",/blogs/wellness/best-infrared-saunas-for-home
"Infrared Sauna vs Traditional: Complete Comparison","infrared vs traditional sauna",Infrared Saunas,comparison,general,comparison,2200,true,,P1,Infrared vs Traditional Sauna: Full Comparison,"Infrared sauna vs traditional sauna — which is better? We compare heat delivery, health benefits, and cost.",/blogs/wellness/infrared-sauna-vs-traditional
"How to Choose Your First Cold Plunge","how to choose cold plunge",Cold Plunges,buyers-guide,first-time,educational,2000,false,"Address common concerns about cold shock",P2,How to Choose a Cold Plunge: Beginner's Guide,"Not sure which cold plunge to buy? This step-by-step guide covers temperature, size, and budget.",/blogs/wellness/how-to-choose-cold-plunge
"Best Exercise Bikes for Home Use","best exercise bike for home",Exercise Bikes,listicle,general,conversational,2000,true,,P1,Best Exercise Bike for Home: Expert Picks,"Find the best exercise bike for home use. Expert-tested picks compared across resistance type, comfort, and durability.",/blogs/wellness/best-exercise-bike-for-home
```
