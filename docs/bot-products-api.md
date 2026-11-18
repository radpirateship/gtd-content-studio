# Bot products API (read-only)

Product titles, handles, prices and Shopify CDN image URLs for external agents
such as Grok Bot (PPW - Email). Same data source as Library > Products in the
app: the live Shopify Admin API, falling back to the cached products table only
if Shopify cannot be reached (`source` in the response says which). No orders,
customers or checkout. No write methods exist on `/api/bot/*`.

Base URL: `https://ppw-content-studio-v2.vercel.app`

## Auth

`Authorization: Bearer <token>` where the token equals the Vercel env var
`BOT_API_TOKEN` (alias `CONTENT_STUDIO_BOT_TOKEN`). Missing or wrong token
answers `401 {"error":"Unauthorized"}`. If the env var is unset the bot path is
disabled and every request is 401. The site cookie gate is unchanged for
everything else.

## Endpoints

`GET /api/bot/products`

| param | meaning |
|---|---|
| `search` | every word must appear in title, vendor, type, tags or handle; without a collection the catalogue is scanned in pages of 250 (up to 15 pages) |
| `collection` | live collection handle, e.g. `infrared-saunas`, `cold-plunges`, `kyota` |
| `category` | app category slug, mapped to its collection handle (`collection` wins if both) |
| `brand` | vendor contains, case-insensitive: `Auroom` finds "Auroom Saunas" |
| `type` | product type contains, e.g. `Sauna` |
| `limit` | 1 to 250, default 50 |
| `since_id` | resume point; pass the previous response's `next_since_id` (null means the catalogue was fully covered) |

`GET /api/bot/products/<handle>` returns one product.

## Response

```json
{
  "products": [
    {
      "id": "8123456789012",
      "title": "Auroom Cala Glass 2-Person Indoor Sauna",
      "handle": "auroom-cala-glass-2-person",
      "url": "https://peakprimalwellness.com/products/auroom-cala-glass-2-person",
      "status": "active",
      "vendor": "Auroom",
      "productType": "Sauna",
      "type": "Sauna",
      "tags": ["indoor", "2-person", "truemed-eligible"],
      "price": "6999.00",
      "compareAtPrice": "7499.00",
      "sku": "AUR-CALA-2",
      "images": ["https://cdn.shopify.com/s/files/1/0585/1224/4854/files/...jpg"],
      "image": "https://cdn.shopify.com/s/files/1/0585/1224/4854/files/...jpg",
      "updatedAt": "2026-09-01T10:15:00-07:00"
    }
  ],
  "count": 1,
  "total": 1,
  "source": "shopify-admin-live",
  "filters": { "search": null, "collection": "infrared-saunas", "brand": null, "type": null, "limit": 50, "since_id": null },
  "next_since_id": null
}
```

`price` and `compareAtPrice` are the first variant's, as strings in USD.
`compareAtPrice` is `null` when the product is not on sale. `images` are
Shopify CDN URLs in the product's image order; `image` is the first one.

## Examples

```bash
# first 50 active products
curl -s -H "Authorization: Bearer $BOT_API_TOKEN" \
  "https://ppw-content-studio-v2.vercel.app/api/bot/products"

# a collection
curl -s -H "Authorization: Bearer $BOT_API_TOKEN" \
  "https://ppw-content-studio-v2.vercel.app/api/bot/products?collection=cold-plunges&limit=20"

# a brand, searched
curl -s -H "Authorization: Bearer $BOT_API_TOKEN" \
  "https://ppw-content-studio-v2.vercel.app/api/bot/products?brand=Auroom&search=glass"

# one product
curl -s -H "Authorization: Bearer $BOT_API_TOKEN" \
  "https://ppw-content-studio-v2.vercel.app/api/bot/products/auroom-cala-glass-2-person"

# walk the whole catalogue: repeat with since_id=<next_since_id> until it is null
curl -s -H "Authorization: Bearer $BOT_API_TOKEN" \
  "https://ppw-content-studio-v2.vercel.app/api/bot/products?limit=250&since_id=0"

# no header -> 401
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://ppw-content-studio-v2.vercel.app/api/bot/products"
```

## Notes

- The Shopify Admin token already installed (Dev Dashboard app) is reused; no
  new app or scopes.
- With `collection`, the whole collection is fetched (paged, no 250 cap) and
  filtered in the app, so `total` is the number of active matches in it.
- `brand`, `type` or `search` without a collection scan the active catalogue
  until `limit` matches are found; `scanned_pages` says how far it went and
  `next_since_id` lets you continue.
- Rotate the token by changing `BOT_API_TOKEN` in Vercel and redeploying.

## Keyword audit (same token)

`GET /api/bot/keyword-audit` (optional `?category=Saunas`): every collection in the
audit with `primary`, `secondaries`, `title_tag`, `meta_description`, `h1`,
`h2_additions`, `rationale`, `risks`, plus the live title and meta, GSC
impressions and clicks, and any `notes`.

`POST /api/bot/keyword-audit/notes` with `{ "notes": [{ "slug": "...", "note": "..." }], "reviewer": "Grok Bot" }`
appends a dated review note per collection. Notes show in the Keyword Audit
panel and are passed to Regenerate as constraints. This is the only write the
bot token can make; it cannot change recommendations, rows or Shopify.

Review checks a second-pass reviewer should run: duplicate primaries across
collections (singular/plural count as the same), a parent collection sharing
its child's primary, informational primaries (how to, what is, benefits) on a
collection page, titles over 60 or metas over 160 characters, a title that does
not contain its primary, a meta quoting a price not on the live page, brands
named that the store does not stock, and em or en dashes anywhere.
