# PPW Master Tagging Reference
**Peak Primal Wellness — Single source of truth for all Shopify article tags**
*Drop this file into any Cowork or Claude session involving articles, the hub, or the Content Studio.*
*Last updated: March 2026 — reflects tagMapping.ts @ commit 658e2c2 + Massage Equipment / Compression Boots / Air Filters additions*

---

## How Tags Work

Every article gets tags from **two layers** applied at publish time:

1. **Category tags** — what topic it covers (drives hub section placement and `/tagged/` filtered blog pages)
2. **Article type tag** — what kind of content it is (drives badge colors on cards)

Tags are built by `lib/tagMapping.ts → buildShopifyTags(categorySlug, articleType)` and applied in `publish-confirm-view.tsx`. The output is a comma-separated string, e.g. `"Saunas, Infrared, Buyer's Guide"`.

---

## Layer 1: Category Tags

### Canonical Mapping — Collection Slug → Shopify Display Tags

This is the authoritative list. These exact strings go into Shopify.

| Collection Slug | Shopify Tags Applied | Hub Section |
|----------------|---------------------|-------------|
| `infrared-saunas` | `Saunas`, `Infrared` | Saunas |
| `barrel-saunas` | `Saunas`, `Barrel Saunas` | Saunas |
| `traditional-saunas` | `Saunas`, `Traditional Saunas` | Saunas |
| `sauna-heaters` | `Saunas`, `Sauna Heaters` | Saunas |
| `sauna-accessories` | `Saunas`, `Sauna Accessories` | Saunas |
| `steam` | `Saunas`, `Steam` | Saunas |
| `saunas` | `Saunas` | Saunas |
| `cold-plunges` | `Recovery`, `Cold Plunges` | Recovery |
| `red-light-therapy` | `Recovery`, `Red Light Therapy` | Recovery |
| `hyperbaric-chambers` | `Recovery`, `Hyperbaric Chambers` | Recovery |
| `sensory-deprivation-tanks` | `Recovery`, `Sensory Deprivation Tanks` | Recovery |
| `massage-equipment` | `Recovery`, `Massage` | Recovery |
| `compression-boots` | `Recovery`, `Compression Boots` | Recovery |
| `recovery-tools` | `Recovery` | Recovery |
| `hydrogen-water` | `Wellness`, `Hydrogen Water` | Wellness |
| `water-ionizers` | `Wellness`, `Water Ionizers` | Wellness |
| `air-filters` | `Wellness`, `Air Filters` | Wellness |
| `general-wellness` | `Wellness` | Wellness |
| `treadmills` | `Fitness`, `Treadmills` | Fitness |
| `elliptical-machines` | `Fitness`, `Elliptical Machines` | Fitness |
| `exercise-bikes` | `Fitness`, `Exercise Bikes` | Fitness |
| `stair-climbers` | `Fitness`, `Stair Climbers` | Fitness |
| `vertical-climbers` | `Fitness`, `Vertical Climbers` | Fitness |
| `pilates` | `Fitness`, `Pilates` | Fitness |

### ⚠️ Critical Rules

- **Never use `Float Tanks` or `float-tanks`** — always `Sensory Deprivation Tanks` / `sensory-deprivation-tanks`
- **Never use `cold-plunge` (singular)** — always `cold-plunges` (plural) — this was a legacy bug, now fixed
- **Never use `infrared-saunas` → `saunas`** — always `infrared-saunas` → `Saunas, Infrared` so the Infrared subtag is preserved
- **Never use `Ionizer`** — always `Water Ionizers`
- **Never use `Massage Chairs` or `massage-chairs`** — always `massage-equipment` slug / `Massage Equipment` display name. The Shopify collection is `/collections/massage-equipment` and the tag is `Massage`.
- **Never use `Massage` alone as a collection name in the CSV** — use `Massage Equipment` (maps to `massage-equipment` slug)

### Hub Section Filtering Tags

These are the tag values the hub JavaScript uses to fetch articles per section:

| Hub Section | Fetch Tag | Includes |
|------------|-----------|---------|
| Saunas | `Saunas` | All sauna subcategories |
| Recovery | `Recovery` | Cold Plunges, Red Light Therapy, Hyperbaric Chambers, Sensory Deprivation Tanks, Massage, Compression Boots |
| Fitness | `Fitness` | Treadmills, Ellipticals, Exercise Bikes, Stair Climbers, Vertical Climbers, Pilates |
| Wellness | `Wellness` | Hydrogen Water, Water Ionizers, Air Filters |

---

## Layer 2: Article Type Tags

### Canonical Mapping — articleType Value → Shopify Display Tag

| `articleType` CSV / UI Value | Shopify Tag | Badge Color | When to Use |
|------------------------------|-------------|-------------|-------------|
| `buyers-guide` | `Buyer's Guide` | `#0066cc` | Product selection articles with criteria and recommendations |
| `comparison` | `Comparison` | `#666666` | Side-by-side analysis of 2+ products, brands, or approaches |
| `how-to` | `How-To` | `#28a745` | Step-by-step instructions, protocols, tutorials |
| `listicle` | `Listicle` | `#fd7e14` | Top 5, Top 10, ranked/numbered lists |
| `benefit-deep-dive` | `Deep Dive` | `#6f42c1` | Single-topic science/research analysis |
| `deep-dive` | `Deep Dive` | `#6f42c1` | Alias for benefit-deep-dive |
| `brand-review` | `Brand Review` | `#17a2b8` | Individual brand or product line review |
| `ultimate-guide` | `Ultimate Guide` | `#1E40AF` | Comprehensive pillar content (3000+ words) |
| `faq` | `FAQ` | `#666666` | Primarily question-driven content |
| `troubleshooting` | `How-To` | `#28a745` | Repair/fix guides (shares badge with how-to) |
| `celebrity` | `Celebrity` | `#e83e8c` | Celebrity/influencer protocol articles |
| `exercise-science` | `Exercise Science` | `#20c997` | Research/science-focused fitness articles |
| `auto` | *(no tag applied)* | — | AI classifies at generation time |

> Every article should have **exactly one** article type tag.

---

## Complete Tag Examples

| Article Title | Collection | articleType | Shopify Tags Result |
|--------------|------------|-------------|---------------------|
| Best Infrared Saunas for Home | `infrared-saunas` | `buyers-guide` | `Saunas, Infrared, Buyer's Guide` |
| VersaClimber vs StairMaster | `vertical-climbers` | `comparison` | `Fitness, Vertical Climbers, Comparison` |
| Cold Plunge Ultimate Guide | `cold-plunges` | `ultimate-guide` | `Recovery, Cold Plunges, Ultimate Guide` |
| How to Use a Sauna | `saunas` | `how-to` | `Saunas, How-To` |
| Best Hydrogen Water Machines | `hydrogen-water` | `buyers-guide` | `Wellness, Hydrogen Water, Buyer's Guide` |
| Barrel Sauna Buyer's Guide | `barrel-saunas` | `buyers-guide` | `Saunas, Barrel Saunas, Buyer's Guide` |
| Andrew Huberman Cardio Protocols | `vertical-climbers` | `celebrity` | `Fitness, Vertical Climbers, Celebrity` |
| VO2 Max Science on a Climber | `vertical-climbers` | `exercise-science` | `Fitness, Vertical Climbers, Exercise Science` |
| Best Massage Chairs for Home | `massage-equipment` | `listicle` | `Recovery, Massage, Listicle` |
| Best Compression Boots for Athletes | `compression-boots` | `listicle` | `Recovery, Compression Boots, Listicle` |
| Best Air Purifiers for Home | `air-filters` | `buyers-guide` | `Wellness, Air Filters, Buyer's Guide` |

---

## Legacy Tags to Remove / Replace

These are wrong tags currently in the system that the Article Fixer Phase 6a cleanup already removed from most articles. If you see them anywhere, replace them:

| Wrong Tag | Correct Tag |
|-----------|-------------|
| `Float Tanks` | `Sensory Deprivation Tanks` |
| `float-tanks` | `Sensory Deprivation Tanks` |
| `Cold Plunge` (capitalized) | `Cold Plunges` |
| `cold-plunge` (singular slug) | `Cold Plunges` |
| `Hydrogen Water` standalone | `Wellness`, `Hydrogen Water` — subcategory tag is correct but needs `Wellness` parent |
| `Hyperbaric Chambers` standalone | `Recovery`, `Hyperbaric Chambers` — subcategory tag is correct but needs `Recovery` parent |
| `Red Light Therapy` standalone | `Recovery`, `Red Light Therapy` — subcategory tag is correct but needs `Recovery` parent |
| `Ionizer` | `Water Ionizers` |
| `infrared-saunas` (slug in Shopify) | `Saunas, Infrared` (display tags) |
| `Massage Chairs` | `Massage` (display tag, from `massage-equipment` slug) |
| `massage-chairs` (slug) | `massage-equipment` (correct slug) |

---

## Where Tags Are Set in Code

| Location | What It Does |
|----------|-------------|
| `lib/tagMapping.ts` | Single source of truth — all slug→display mappings, `buildShopifyTags()` function |
| `components/publish-confirm-view.tsx` | Calls `buildShopifyTags(article.category, article.articleType)` at publish |
| `components/bulk-upload-view.tsx` | Reads `articleType` from CSV, passes to `saveArticleToDb()` and article object |
| `app/api/articles/route.ts` | Saves `article_type` column to DB on POST, returns it on GET |
| `app/page.tsx` | Maps `a.article_type` → `articleType` when loading articles from DB |
| `ppw-article-fixer` → `api/fix-tags/cleanup` | Phase 6a — runs normalizeTags() to fix legacy tags in bulk |

---

## Wellness Hub — How Tags Drive Section Display

The hub at `/pages/wellness-hub` fetches articles using the JSON endpoint:
```
/search?view=articles-json&tag=Saunas&limit=8
/search?view=articles-json&tag=Recovery&limit=8
/search?view=articles-json&tag=Fitness&limit=8
/search?view=articles-json&tag=Wellness&limit=8
```

| Hub Section | Fetch Tag | Includes |
|------------|-----------|---------|
| Saunas | `Saunas` | All sauna subcategories |
| Recovery | `Recovery` | Cold Plunges, Red Light Therapy, Hyperbaric Chambers, Sensory Deprivation Tanks, Massage, Compression Boots |
| Fitness | `Fitness` | Treadmills, Ellipticals, Exercise Bikes, Stair Climbers, Vertical Climbers, Pilates |
| Wellness | `Wellness` | Hydrogen Water, Water Ionizers, Air Filters |

The endpoint template is `templates/search.articles-json.liquid`. It filters `blogs['wellness'].articles` by tag. Articles only appear in hub sections if they carry the correct parent tag (`Recovery`, `Wellness` etc.).

**Subcategory pill filtering** works client-side — articles carry both the parent tag AND subcategory tags, so pills filter the already-loaded grid without a new fetch.

**Backfill note:** Existing articles published before this change need `Recovery` or `Wellness` added via the Article Fixer `POST /api/fix-tags/add-parent-tags` route.

---

## CSV Bulk Upload — Tag-Relevant Columns

| CSV Column | Maps To | Notes |
|------------|---------|-------|
| `collection` | `article.category` (slug) | Use display names like `Massage Equipment` or slugs like `massage-equipment` — both work |
| `articleType` | `article.articleType` | Use values from the articleType column above |
| `shopifySlug` | `article.slug` | Include `/blogs/wellness/` prefix — it gets stripped automatically |

---

## App Code — What Needs Updating for New Collections

When adding `compression-boots` or `air-filters` (or any new collection), update **all four locations**:

### 1. `lib/tagMapping.ts`
Add entries to the slug→tags map:
```ts
'compression-boots': ['Recovery', 'Compression Boots'],
'air-filters': ['Wellness', 'Air Filters'],
```

Also add display-name → slug aliases so the CSV parser accepts human-friendly names:
```ts
'compression boots': 'compression-boots',
'massage equipment': 'massage-equipment',    // alias — fixes old "Massage Chairs" / "Massage" entries
'massage chairs': 'massage-equipment',        // legacy alias — catch stale CSVs
'air filters': 'air-filters',
```

### 2. `components/bulk-upload-view.tsx` — collection dropdown
Add to the `<select>` options list:
```tsx
<option value="Massage Equipment">Massage Equipment</option>
<option value="Compression Boots">Compression Boots</option>
<option value="Air Filters">Air Filters</option>
```
Remove or replace:
```tsx
// DELETE: <option value="Massage Chairs">Massage Chairs</option>
```

### 3. Resources upload UI — collection dropdown
Same additions as bulk-upload-view.tsx — wherever the collection `<select>` appears in the resources/products upload screen.

### 4. Products upload — collection/category field
If products have a collection dropdown during CSV import, apply the same changes.

---

*This document reflects tagMapping.ts as of commits `658e2c2` (celebrity + exercise-science added), `0f38c92` (cold-plunges fix, infrared-saunas fix, slug strip), `d67ab84` (articleType DB persistence fix), the Recovery/Wellness parent tag update, and the March 2026 additions: `massage-equipment` canonical rename, `compression-boots`, `air-filters`.*
