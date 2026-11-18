import { type NextRequest, NextResponse } from "next/server";
import { productStore, type Product } from "@/lib/product-store";
import { EXCLUDED_VENDORS, isExcludedVendor, liftedVendors } from "@/lib/product-exclusions";
import { dedupeVariants } from "@/lib/product-picker";
import { CATEGORY_TO_COLLECTION } from "@/lib/shopify";
import { fetchAdminProducts } from "@/lib/shopify/products-admin";
import { getSQL } from "@/lib/db";

// Allow large CSV uploads (up to 50MB)
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function generateStaticParams() { return [] }

// Load products from database into memory store on first request
let isInitialized = false;

// Fetch products LIVE from the Shopify Admin API, narrowed by collection
// (sub-collection), vendor (brand), and/or product type. Replaces the old
// Storefront path (which needed a token the Dev Dashboard app can't issue).
async function fetchFromShopify(opts: {
  category?: string | null;
  collectionHandle?: string | null;
  vendor?: string | null;
  productType?: string | null;
  limit?: number;
}): Promise<Product[]> {
  const { category, collectionHandle, vendor, productType, limit = 24 } = opts;
  const handle = collectionHandle || (category ? (CATEGORY_TO_COLLECTION[category] || category) : undefined);
  return fetchAdminProducts({ collectionHandle: handle, vendor, productType, limit });
}

async function initializeFromDatabase(collectionSlug?: string) {
  if (isInitialized && productStore.getAll().length > 0 && !collectionSlug) return;
  
  try {
    const sql = getSQL();
    const rows = collectionSlug
      ? await sql`SELECT * FROM products WHERE collection_slug = ${collectionSlug} ORDER BY title`
      : await sql`SELECT * FROM products ORDER BY title`;
    if (rows.length > 0) {
      const products: Product[] = rows.map(row => ({
        id: row.id.toString(),
        title: row.title || "",
        description: row.description || "",
        price: row.price || "",
        compareAtPrice: row.compare_at_price || "",
        sku: row.sku || "",
        vendor: row.vendor || "",
        productType: row.product_type || "",
        tags: row.tags || "",
        category: row.category || "",
        imageUrl: row.image_url || "",
        handle: row.handle || "",
        status: row.status || "active",
        inventoryQty: row.inventory_qty || "",
        url: row.url || "",
      }));
      productStore.setProducts(products);
      console.log(`[v0] Loaded ${products.length} products from database${collectionSlug ? ` (collection: ${collectionSlug})` : ''}`);
    }
    isInitialized = true;
  } catch (error) {
    console.error("[v0] Failed to load products from database:", error);
  }
}

// ============================================================================
// RELEVANCE SCORING — match products to article content
// ============================================================================

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'is', 'it', 'as', 'be', 'was', 'are', 'were', 'been',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'can', 'may', 'would',
  'should', 'could', 'this', 'that', 'these', 'those', 'my', 'your', 'our',
  'its', 'his', 'her', 'their', 'what', 'which', 'who', 'how', 'why', 'when',
  'where', 'not', 'no', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'some', 'such', 'than', 'too', 'very', 'just', 'also', 'about',
  'best', 'top', 'good', 'great', 'new', 'use', 'using', 'used', 'guide',
  'review', 'complete', 'ultimate', 'vs', 'versus', '2024', '2025', '2026',
]);

function extractSearchTerms(searchString: string): string[] {
  return searchString
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function scoreProduct(product: Product, searchTerms: string[]): number {
  if (searchTerms.length === 0) return 0;
  const titleLower = (product.title || '').toLowerCase();
  const tagsLower = (product.tags || '').toLowerCase();
  const typeLower = (product.productType || '').toLowerCase();
  const handleLower = (product.handle || '').toLowerCase();
  const descLower = (product.description || '').slice(0, 500).toLowerCase();
  let score = 0;
  // The whole keyword as a phrase, worth more than the sum of its words.
  // "Best weight bench" was outscored by preacher curl benches and a
  // functional trainer because every product in the collection contains
  // "bench" somewhere; the products literally titled "Weight Bench" are the
  // article's subject and must rank first.
  const phrase = searchTerms.join(' ');
  if (searchTerms.length > 1 && phrase.length > 5) {
    if (titleLower.includes(phrase)) score += 25;
    else if (typeLower.includes(phrase) || tagsLower.includes(phrase)) score += 12;
  }
  for (const term of searchTerms) {
    if (titleLower.includes(term)) score += 10;
    if (handleLower.includes(term)) score += 6;
    if (tagsLower.includes(term)) score += 5;
    if (typeLower.includes(term)) score += 4;
    if (descLower.includes(term)) score += 2;
  }
  if (product.imageUrl) score += 8;
  if (product.price && product.price !== '0') score += 3;
  // Ticket size as a tiebreaker within a keyword match. Without it a $21
  // compression sleeve outranked a $1,700 wall station on a "home gym
  // essentials" article because both mention "home gym". Logarithmic, so it
  // nudges rather than dominates: $20 adds ~1, $500 ~3, $5,000 ~4.
  const price = parseFloat(product.price || '0');
  if (price > 1) score += Math.min(5, Math.log10(price));
  return score;
}

/**
 * GTD sells high-ticket equipment, so featured picks should be real equipment
 * rather than accessories, without all four being the $30k flagships either.
 *
 * Two rules, both relaxing automatically when a collection cannot satisfy them:
 *  1. A price FLOOR: products under $1,000 are dropped when the collection has
 *     enough above it (at least twice the number of cards). The floor steps
 *     down to $500, $250, then off, so a massage gun collection still works.
 *  2. A CEILING on the very top: at most two of the picks may come from the
 *     most expensive 10% of the pool, so a sauna article shows a range rather
 *     than four $40k cabins.
 * Floor: PRODUCT_PICK_MIN_PRICE env (default 1000) or ?minPrice= per request.
 */
const DEFAULT_MIN_PRICE = Number(process.env.PRODUCT_PICK_MIN_PRICE || 1000);

const TOP_BAND_PCT = 90;
const TOP_BAND_CAP = 2;

function aboveFloor(products: Product[], floor: number, needed: number): { kept: Product[]; floorUsed: number } {
  const priced = products.filter(p => parseFloat(p.price || '0') > 0);
  if (!priced.length || floor <= 0) return { kept: products, floorUsed: 0 };
  // The floor is relative to the category, capped at the request floor. A
  // flat $1,000 worked for saunas and plunges but on weight benches it kept
  // 8+ specialty pieces over $1,000 and silently removed every actual
  // pressing bench (all under $1,000), so a "best weight bench" article
  // featured no weight bench. Cap the floor at the pool's 40th percentile:
  // the bottom of the category still drops, the heart of it never does.
  const sortedPrices = priced.map(p => parseFloat(p.price)).sort((a, b) => a - b);
  const p40 = sortedPrices[Math.floor(0.4 * (sortedPrices.length - 1))];
  if (p40 < floor) {
    console.log(`[v0] Product price floor capped at category 40th percentile: $${floor} -> $${Math.round(p40)}`);
    floor = p40;
  }
  const steps = [floor, floor / 2, floor / 4, 0];
  for (const f of steps) {
    const kept = f > 0 ? priced.filter(p => parseFloat(p.price) >= f) : products;
    if (kept.length >= needed * 2 || f === 0) {
      console.log(`[v0] Product price floor: $${f} -> ${kept.length} of ${products.length} candidates${f !== floor ? ` (relaxed from $${floor})` : ''}`);
      return { kept, floorUsed: f };
    }
  }
  return { kept: products, floorUsed: 0 };
}

function topBandCutoff(products: Product[]): number {
  const prices = products.map(p => parseFloat(p.price || '0')).filter(n => n > 0).sort((a, b) => a - b);
  if (prices.length < 10) return Infinity;
  return prices[Math.floor((TOP_BAND_PCT / 100) * prices.length)];
}

function selectRelevantProducts(allProducts: Product[], searchTerms: string[], maxItems: number, minPrice = DEFAULT_MIN_PRICE, opts?: { lifted?: ReadonlySet<string>; vendorCap?: number }): Product[] {
  const beforeExclude = allProducts.length;
  // General articles skip the excluded vendors. An article about that
  // vendor or its product type (targetBrand, title, keyword, sub-collection)
  // lifts the exclusion for the vendors it names.
  allProducts = allProducts.filter(p => !isExcludedVendor(p, opts?.lifted));
  if (allProducts.length !== beforeExclude) {
    console.log(`[v0] Product picker: excluded ${beforeExclude - allProducts.length} product(s) from banned vendor(s): ${[...EXCLUDED_VENDORS].join(', ')}`);
  }
  // Colour variants are not choices: 37 treatment tables are really 11. Shared
  // with lib/product-picker.ts so blogs and guides collapse identically.
  const beforeVariants = allProducts.length;
  allProducts = dedupeVariants(allProducts);
  if (allProducts.length !== beforeVariants) {
    console.log(`[v0] Products: ${beforeVariants} collapsed to ${allProducts.length} distinct models`);
  }
  allProducts = aboveFloor(allProducts, minPrice, maxItems).kept;
  const topCut = topBandCutoff(allProducts);
  const scored = allProducts.map(p => ({
    product: p,
    relevance: scoreProduct(p, searchTerms),
    tiebreaker: Math.random(),
  }));
  scored.sort((a, b) => b.relevance !== a.relevance ? b.relevance - a.relevance : a.tiebreaker - b.tiebreaker);
  const topScore = scored[0]?.relevance || 0;
  console.log(`[v0] Product scoring: ${scored.length} products, top score=${topScore}, search="${searchTerms.join(' ')}"`);
  if (scored.length > 0) {
    console.log(`[v0] Top 6 matches: ${scored.slice(0, 6).map(s => `${s.product.title?.slice(0, 40)} (${s.relevance})`).join(' | ')}`);
  }
  // Vendor diversity. An umbrella article ("Home Gym Essentials") scored four
  // BenchK wall bars because every BenchK title contains "Home Gym". Cap each
  // vendor at two of the picks while other vendors are available, keeping
  // score order within that constraint; fall back to pure score order when
  // the pool is effectively one vendor.
  const picked: Product[] = [];
  const perVendor = new Map<string, number>();
  const perType = new Map<string, number>();
  // One product per vendor when the pool allows it — the backfill below
  // relaxes the cap automatically when it does not, so a small pool still
  // fills all four cards. This replaced the BenchK vendor ban: four wall
  // bars in one article was a vendor-diversity problem, not a BenchK one.
  const cap = Math.max(1, opts?.vendorCap ?? 1);
  const typeCap = 2;
  let topBand = 0;
  for (const s of scored) {
    if (picked.length >= maxItems) break;
    const v = (s.product.vendor || '').toLowerCase() || '__none__';
    const t = (s.product.productType || '').toLowerCase() || '__none__';
    if ((perVendor.get(v) || 0) >= cap) continue;
    if ((perType.get(t) || 0) >= typeCap) continue;
    const isTop = parseFloat(s.product.price || '0') >= topCut;
    if (isTop && topBand >= TOP_BAND_CAP) continue;
    picked.push(s.product);
    perVendor.set(v, (perVendor.get(v) || 0) + 1);
    perType.set(t, (perType.get(t) || 0) + 1);
    if (isTop) topBand++;
  }
  if (picked.length < maxItems) {
    for (const s of scored) {
      if (picked.length >= maxItems) break;
      if (!picked.includes(s.product)) picked.push(s.product);
    }
  }
  return picked;
}

// ============================================================================
// GET HANDLER
// ============================================================================

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const category = searchParams.get("category");
  const collection = searchParams.get("collection");
  const search = searchParams.get("search");
  const limit = searchParams.get("limit");
  const maxItems = parseInt(limit || "8", 10);
  // Targeting params: narrow featured products to a sub-collection / brand / type.
  const brand = searchParams.get("brand");
  const subcollection = searchParams.get("subcollection");
  const productType = searchParams.get("productType");
  const minPrice = Number(searchParams.get("minPrice") || DEFAULT_MIN_PRICE);
  const vendorCap = Number(searchParams.get("vendorCap") || 0) || undefined;

  console.log(`[Products GET] Incoming - category: "${category}", collection: "${collection}", search: "${search}", brand: "${brand}", subcollection: "${subcollection}", productType: "${productType}"`);
  const lifted = liftedVendors({ keyword: search, brand, subcollection, collection });
  if (lifted.size) console.log(`[Products GET] Vendor exclusion lifted for: ${[...lifted].join(', ')}`);

  const collectionSlug = collection || (category ? (CATEGORY_TO_COLLECTION[category] || category) : null);
  console.log(`[Products GET] Resolved collectionSlug: "${collectionSlug}"`);

  // PRIORITY 0: LIVE from the Shopify Admin API, always. Ryan: "we switched to
  // it pulling directly from Shopify and not the Matrixify CSV". The live
  // product carries the full body_html, vendor, type and tags, which is what
  // the article writer needs; the products table is a snapshot of whatever CSV
  // was last imported and drifts. Until this change the live path only ran when
  // a brand, sub-collection or type was specified, or when the table was empty,
  // so most articles were written from the stale import. The cached table is
  // now the fallback for when Shopify is unreachable, nothing more.
  if (collectionSlug && collectionSlug !== "all") {
    const targetHandle = subcollection || collectionSlug;
    // The whole collection, not its first 60 in Shopify's default order. A
    // 600-product umbrella collection scored from its first page was picking
    // accessories because that is what happened to sort first.
    const live = await fetchFromShopify({
      collectionHandle: targetHandle,
      vendor: brand,
      productType,
      limit: 250,
    });
    // A thin sub-collection must not thin the article. When the resolved
    // handle returns fewer products than the article needs, top the pool up
    // from the PARENT collection before selecting, and say so in the log:
    // a bench article shipped with 2 cards because its handle only held 2
    // while the umbrella collection held plenty.
    let pool = live;
    if (pool.length < maxItems && subcollection && collectionSlug && subcollection !== collectionSlug) {
      const parent = await fetchFromShopify({ collectionHandle: collectionSlug, vendor: brand, productType, limit: 250 });
      if (parent.length) {
        const have = new Set(pool.map((p) => (p.handle || "").toLowerCase()));
        pool = [...pool, ...parent.filter((p) => !have.has((p.handle || "").toLowerCase()))];
        console.warn(`[Products GET] Sub-collection "${targetHandle}" returned only ${live.length}; topped up from parent "${collectionSlug}" to ${pool.length} candidates.`);
      }
    }
    if (pool.length > 0) {
      const searchTerms = search ? extractSearchTerms(search) : [];
      const selected = searchTerms.length > 0
        ? selectRelevantProducts(pool, searchTerms, maxItems, minPrice, { lifted, vendorCap })
        : selectRelevantProducts(pool, targetHandle.replace(/-/g, ' ').split(' '), maxItems, minPrice, { lifted, vendorCap });
      console.log(`[Products GET] Live Shopify matched ${selected.length}/${pool.length} (handle=${targetHandle}${brand ? `, brand=${brand}` : ''}${productType ? `, type=${productType}` : ''})`);
      return NextResponse.json({ products: selected, total: pool.length, source: "shopify-admin-live" });
    }
    console.warn(`[Products GET] Live Shopify returned 0 for "${targetHandle}", falling back to the cached products table.`);
  }

  // PRIORITY 1: Database products with relevance scoring
  if (collectionSlug && collectionSlug !== "all") {
    try {
      const sql = getSQL();
      let rows = await sql`SELECT * FROM products WHERE collection_slug = ${collectionSlug}`;
      console.log(`[Products GET] DB Query (exact slug = '${collectionSlug}') returned ${rows.length} rows.`);

      // FALLBACK: If exact slug misses, try a broad ILIKE search
      if (rows.length === 0) {
        const fallbackTerm = `%${(category || collectionSlug).replace(/-/g, '%')}%`;
        console.log(`[Products GET] Exact match missed. Falling back to ILIKE '${fallbackTerm}'`);
        rows = await sql`SELECT * FROM products WHERE category ILIKE ${fallbackTerm} OR product_type ILIKE ${fallbackTerm} OR collection_slug ILIKE ${fallbackTerm}`;
        console.log(`[Products GET] DB Query (ILIKE) returned ${rows.length} rows.`);
      }

      if (rows.length > 0) {
        const dbProducts: Product[] = rows.map(row => ({
          id: row.id.toString(), title: row.title || "", description: row.description || "",
          price: row.price || "", compareAtPrice: row.compare_at_price || "", sku: row.sku || "",
          vendor: row.vendor || "", productType: row.product_type || "", tags: row.tags || "",
          category: row.category || "", imageUrl: row.image_url || "", handle: row.handle || "",
          status: row.status || "active", inventoryQty: row.inventory_qty || "", url: row.url || "",
        }));
        // Brand = Shopify vendor. When a brand is requested, never return other brands.
        const brandScoped = brand
          ? dbProducts.filter((p) => (p.vendor || "").toLowerCase().includes(brand.toLowerCase()))
          : dbProducts;
        if (brandScoped.length > 0) {
          const searchTerms = search ? extractSearchTerms(search) : [];
          const selectedProducts = searchTerms.length > 0
            ? selectRelevantProducts(brandScoped, searchTerms, maxItems, minPrice, { lifted, vendorCap })
            : selectRelevantProducts(brandScoped, collectionSlug.replace(/-/g, ' ').split(' '), maxItems, minPrice);
          console.log(`[v0] Products: matched ${selectedProducts.length}/${brandScoped.length} from DB (collection: ${collectionSlug}${brand ? `, brand: ${brand}` : ''})`);
          return NextResponse.json({ products: selectedProducts, total: brandScoped.length, source: "database-scored", collectionSlug });
        }
        console.log(`[Products GET] DB had rows but none matched${brand ? ` brand "${brand}"` : ''} — falling through.`);
      } else {
        console.log(`[Products GET] DB returned 0 rows. Falling through to Shopify API...`);
        // No hard return — fall through to Priority 2
      }
    } catch (error) {
      console.error("[v0] Failed to fetch scored products from DB:", error);
    }
  }

  // PRIORITY 2: Live Shopify Admin API fallback (respects brand=vendor + sub-collection)
  if (category && category !== "all") {
    console.log(`[v0] Products: no DB products for "${collectionSlug}", trying Shopify Admin API`);
    const shopifyProducts = await fetchFromShopify({
      category,
      collectionHandle: subcollection || collectionSlug,
      vendor: brand,
      productType,
      limit: Math.max(maxItems * 4, 20),
    });
    if (shopifyProducts.length > 0) {
      const searchTerms = search ? extractSearchTerms(search) : [];
      const selected = searchTerms.length > 0 ? selectRelevantProducts(shopifyProducts, searchTerms, maxItems, minPrice) : shopifyProducts.slice(0, maxItems);
      console.log(`[v0] Products: scored ${selected.length}/${shopifyProducts.length} from Shopify`);
      return NextResponse.json({ products: selected, total: shopifyProducts.length, source: "shopify-scored" });
    }
  }

  // PRIORITY 3: In-memory store fallback
  isInitialized = false;
  await initializeFromDatabase();
  let products = productStore.getAll();
  if (category && category !== "all") {
    products = productStore.getByCategory(category);
    if (products.length === 0) {
      const allProducts = productStore.getAll();
      const categoryWords = category.toLowerCase().replace(/-/g, ' ').split(' ');
      products = allProducts.filter(p => {
        const searchText = [p.title, p.description, p.productType, p.tags, p.vendor].filter(Boolean).join(' ').toLowerCase();
        return categoryWords.some(word => word.length > 2 && searchText.includes(word));
      });
    }
  }
  if (search && products.length > 0) {
    const searchTerms = extractSearchTerms(search);
    if (searchTerms.length > 0) products = selectRelevantProducts(products, searchTerms, maxItems);
  } else {
    products = products.map(p => ({ product: p, sort: (p.imageUrl ? 100 : 0) + (p.price ? 10 : 0) + Math.random() * 5 }))
      .sort((a, b) => b.sort - a.sort).slice(0, maxItems).map(s => s.product);
  }
  return NextResponse.json({ products: products.slice(0, maxItems), total: products.length, categories: productStore.getCategories() });
}

export async function POST(request: NextRequest) {
  try {
    let products: Product[] = [];
    let collectionSlug: string | null = null;
    // Batched uploads: only the first batch clears the scope.
    let appendMode = false;
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = await request.json();
      collectionSlug = body.collection_slug || null;
      appendMode = body.append === true;
      products = (body.products || []).map((p: Record<string, string>) => ({
        id: p.id || p.handle || `product-${Math.random().toString(36).slice(2)}`,
        title: p.title || "", description: p.description || "", price: p.price || "",
        compareAtPrice: p.compareAtPrice || "", sku: p.sku || "", vendor: p.vendor || "",
        productType: p.productType || "", tags: p.tags || "", category: p.category || p.productType || "",
        imageUrl: p.imageUrl || "", handle: p.handle || "", status: p.status || "active",
        inventoryQty: p.inventoryQty || "", url: p.url || "",
      }));
    } else {
      const formData = await request.formData();
      const file = formData.get("file") as File;
      collectionSlug = formData.get("collection_slug") as string | null;
      if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
      const text = await file.text();
      const lines = text.split("\n");
      if (lines.length < 2) return NextResponse.json({ error: "CSV file is empty or invalid" }, { status: 400 });
      const headers = parseCSVLine(lines[0]);
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseCSVLine(line);
        const product: Record<string, string> = {};
        headers.forEach((header, index) => { product[header.trim()] = values[index]?.trim() || ""; });
        const title = product["Title"] || "";
        const handle = product["Handle"] || "";
        if (!title && products.length > 0 && products[products.length - 1].handle === handle) continue;
        if (title) {
          products.push({
            id: product["ID"] || handle || `product-${i}`, title,
            description: product["Body (HTML)"] || product["Body HTML"] || "",
            price: product["Variant Price"] || "", compareAtPrice: product["Variant Compare At Price"] || "",
            sku: product["Variant SKU"] || "", vendor: product["Vendor"] || "",
            productType: product["Product Type"] || product["Type"] || "",
            tags: product["Tags"] || "", category: product["Product Type"] || product["Type"] || "",
            imageUrl: product["Image Src"] || "", handle,
            status: product["Status"] || "active",
            inventoryQty: product["Total Inventory Qty"] || product["Variant Inventory Qty"] || "",
            url: product["URL"] || "",
          });
        }
      }
    }

    if (products.length === 0) return NextResponse.json({ error: "No products found in file" }, { status: 400 });

    productStore.setProducts(products);

    try {
      const sql = getSQL();
      if (!appendMode) {
        if (collectionSlug) {
          await sql`DELETE FROM products WHERE collection_slug = ${collectionSlug}`;
        } else {
          await sql`DELETE FROM products WHERE collection_slug IS NULL`;
        }
      }
      const sortedProducts = [...products].sort((a, b) => (a.imageUrl && !b.imageUrl ? -1 : !a.imageUrl && b.imageUrl ? 1 : 0));
      const productsToSave = sortedProducts.filter(p => p.title).slice(0, 1000);
      const handleCounts: Record<string, number> = {};
      for (let i = 0; i < productsToSave.length; i++) {
        const p = productsToSave[i];
        let uniqueHandle = p.handle || `product-${i}`;
        if (handleCounts[uniqueHandle] !== undefined) {
          handleCounts[uniqueHandle]++;
          uniqueHandle = `${p.handle}-${handleCounts[uniqueHandle]}`;
        } else {
          handleCounts[uniqueHandle] = 0;
        }
        try {
          await sql`
            INSERT INTO products (handle, title, description, price, compare_at_price, sku, vendor, product_type, tags, category, image_url, status, inventory_qty, url, collection_slug)
            VALUES (${uniqueHandle}, ${p.title}, ${p.description?.slice(0, 30000)}, ${p.price}, ${p.compareAtPrice}, ${p.sku}, ${p.vendor}, ${p.productType}, ${p.tags}, ${p.category}, ${p.imageUrl}, ${p.status}, ${p.inventoryQty}, ${p.url}, ${collectionSlug || null})
            ON CONFLICT (handle) DO UPDATE SET
              title = EXCLUDED.title, description = EXCLUDED.description, price = EXCLUDED.price,
              compare_at_price = EXCLUDED.compare_at_price, vendor = EXCLUDED.vendor,
              product_type = EXCLUDED.product_type, tags = EXCLUDED.tags, category = EXCLUDED.category,
              image_url = EXCLUDED.image_url, status = EXCLUDED.status, inventory_qty = EXCLUDED.inventory_qty,
              url = EXCLUDED.url, collection_slug = EXCLUDED.collection_slug
          `;
        } catch (e) {
          console.error('[v0] Failed to insert product:', uniqueHandle, e);
        }
        if (i > 0 && i % 50 === 0) await new Promise(resolve => setTimeout(resolve, 100));
      }
      console.log(`[v0] Saved ${productsToSave.length} products to database${collectionSlug ? ` (collection: ${collectionSlug})` : ''}`);
    } catch (dbError) {
      console.error("[v0] Failed to save products to database:", dbError);
    }

    isInitialized = true;
    return NextResponse.json({ success: true, count: products.length, categories: productStore.getCategories(), collectionSlug: collectionSlug || null, sample: products.slice(0, 5) });
  } catch (error) {
    console.error("CSV parse error:", error);
    return NextResponse.json({ error: "Failed to parse CSV file" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const collection = searchParams.get("collection");
  try {
    productStore.clear();
    isInitialized = false;
    try {
      const sql = getSQL();
      if (collection) await sql`DELETE FROM products WHERE collection_slug = ${collection}`;
      else await sql`DELETE FROM products`;
    } catch (dbError) {
      console.error("[v0] Failed to clear products from database:", dbError);
    }
    return NextResponse.json({ success: true, message: collection ? `Products cleared for ${collection}` : "All products removed" });
  } catch (error) {
    console.error("[v0] Error clearing products:", error);
    return NextResponse.json({ error: "Failed to clear products" }, { status: 500 });
  }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) { result.push(current); current = ""; }
    else current += char;
  }
  result.push(current);
  return result;
}
