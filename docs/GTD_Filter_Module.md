# GTD Product Filter Module

Bulk-derives structured product attributes (metafields) so Shopify Search &
Discovery can power sidebar filters on collection pages. Lives inside Content
Studio but is deliberately isolated: it has its own routes, its own UI at
`/product-filters`, and its own mandatory preview-before-write gate. It shares
nothing with the article/collection publish flow.

## What it never does

- Never touches URLs, redirects, or link allocation (barrel-saunas,
  outdoor-saunas, hyperbaric-chambers stay untouched by design — the module
  only writes product metafields, which have no effect on URLs).
- Never changes collection publish state, tags, titles, descriptions, themes.
- Never deletes a metafield value: blank cells in the preview are skipped.
- Never writes without a human reviewing the preview and typing APPLY.

## Files

| File | Role |
|---|---|
| `lib/metafields/config.ts` | Category + facet registry (taxonomy, allowed values). Add new categories here. |
| `lib/metafields/derive.ts` | Rules engine: title/tags/description → facet values + confidence + flags. |
| `lib/metafields/admin.ts` | Admin GraphQL client: fetch products, definitions status/create, batched `metafieldsSet`. |
| `lib/metafields/diff.ts` | Delta-only comparison (normalized, so cosmetic differences don't count). |
| `app/api/metafields/scan/route.ts` | Dry run: fetch + derive + diff. Zero writes. |
| `app/api/metafields/definitions/route.ts` | Check/create metafield definitions (storefront-visible, pinned). |
| `app/api/metafields/apply/route.ts` | The only write path. Gated, validated, delta-only, re-runnable. |
| `app/api/metafields/suggest/route.ts` | AI-assist for flagged rows (reads descriptions, proposes values with reasoning; never writes to Shopify). |
| `components/product-filters-view.tsx` | Review UI: definitions panel, scan, AI-suggest, editable preview, gated apply. Rendered as the Product Filters topbar mode and at `/product-filters`. |

## Workflow

1. **Definitions first.** `/product-filters` → Check definitions → Create
   missing. Values written before a definition exists (or without storefront
   visibility) are invisible to Search & Discovery — this is the standard
   failure mode, so apply is hard-blocked until definitions are ready.
2. **Scan (dry run).** Pulls every product matching the category's product
   query live from the Admin API, derives values, diffs against what's
   currently on each product. Nothing is written.
3. **Review.** Flagged rows start excluded from apply and are highlighted;
   every cell is editable. Derivation rules never guess: a facet that can't
   be derived confidently comes back blank + flagged.
   **AI-suggest (optional):** the "AI-suggest for flagged" button has Claude
   read each flagged product's full description and propose values for the
   unsettled facets, with one line of reasoning shown in purple under the
   cell. It only fills blank cells (never overwrites derived values or manual
   edits), returns "no evidence" rather than guessing, validates every
   suggestion against the allowed value list, and writes nothing to Shopify —
   suggestions still go through row check-in and the APPLY gate.
4. **Apply.** Type APPLY. The server re-reads Shopify at write time, writes
   only real deltas in batches of 25, and reports per-product results.
   Re-running after a partial failure only rewrites what still differs.

## Derivation ground rules (saunas)

- Range tags (`3-6 person`) are collection bucket tags, NOT capacity truth.
  Capacity comes from the title first, exact single-number tags second.
- Capacity is a **list** metafield: a "1-2 Person" model carries both
  `1-person` and `2-person` so it matches either filter selection.
- Heater Type is a **list**: every heater the sauna supports or ships with.
  Ryan's rule (2026-08-10): every traditional sauna works with an electric
  heater, so all of them carry `electric`; `wood-burning` is added only on
  evidence of wood-stove compatibility, where a chimney/flue in the
  description is the #1 signifier (explicit wood-fired stove mentions also
  count). Descriptions that mention only generic ventilation get flagged for
  a human call instead of a guess.
- Heat Type is a **list**: hybrids carry `infrared`, `traditional`, AND
  `hybrid`, so they surface under any of those filter choices.
- Wood Type is a **list**: a sauna carries every wood with construction-level
  evidence (walls vs benches often differ). Only passing-mention-only cases
  are flagged.

## After apply: two manual steps in Shopify admin

1. **Search & Discovery → Filters → Add filter** — add each new metafield as
   a filter (one-time per facet; Shopify has no API for this).
2. **Canonical check on filtered URLs** (do once filters are live): load a
   filtered collection URL, e.g.
   `/collections/saunas?filter.p.m.custom.capacity=4-person`, view source,
   and confirm `<link rel="canonical">` points at the clean
   `/collections/saunas` URL. Shopify's standard themes handle this via
   `canonical_url`, but verify on the custom theme rather than assuming —
   indexed filter-parameter URLs would recreate the cannibalization problem
   in parameter form. If the canonical is wrong, the fix is one line in
   `theme.liquid` (use `canonical_url`), which is a theme edit (the app token
   deliberately has no `write_themes`).

## Adding the next category (e.g. cold plunges)

1. Add a `FilterCategory` entry in `lib/metafields/config.ts` (facets +
   allowed values + a `productQuery` that bounds the product set).
2. Add a derivation rule set in `lib/metafields/derive.ts` and register it in
   `DERIVERS`. Reuse the existing primitives (capacity regexes, keyword
   helpers) where they fit.
3. Everything else (definitions, scan, preview UI, apply) picks the new
   category up automatically from the registry.

## Storefront filter UI

The sidebar filters themselves are rendered by the theme's built-in
Search & Discovery faceting once filters are activated in the S&D app. Facet
order recommendation for sauna collections: Capacity, Placement, Heat Type,
Price (existing), then Heater Type, Wood Type, EMF Level. On
non-type-specific parent collections (`/collections/saunas`,
`/collections/outdoor-saunas`), Heat Type does the job the sub-collection
links used to do; on type-specific collections it can be hidden in the S&D
app per-collection settings.
