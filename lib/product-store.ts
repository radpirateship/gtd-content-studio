// In-memory product store matching Shopify export schema
export interface Product {
  id: string;
  title: string;
  description: string;
  price: string;
  compareAtPrice?: string;
  sku?: string;
  vendor?: string;
  productType?: string;
  tags?: string;
  category?: string;
  imageUrl?: string;
  handle?: string;
  status?: string;
  inventoryQty?: string;
  url?: string;
}

// Category keywords for wellness equipment matching
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'sensory-deprivation-tanks': ['float', 'sensory deprivation', 'isolation tank', 'flotation', 'float tank', 'float pod'],
  'saunas': ['sauna', 'infrared sauna', 'barrel sauna', 'traditional sauna'],
  'cold-plunge': ['cold plunge', 'ice bath', 'cold tub', 'cold therapy', 'cryotherapy'],
  'red-light-therapy': ['red light', 'led therapy', 'photobiomodulation', 'light therapy panel'],
  'hyperbaric-chambers': ['hyperbaric', 'oxygen chamber', 'hbot'],
  'massage-equipment': ['massage', 'percussion', 'theragun', 'massage chair', 'massage gun'],
  'recovery-tools': ['recovery', 'compression', 'normatec', 'foam roller'],
  'general-wellness': ['wellness', 'health', 'fitness'],
  'steam': ['steam shower', 'steam generator', 'steam room', 'mrsteam', 'kohler steam', 'thermasol', 'towel warmer', 'steam bath']
};

class ProductStore {
  private products: Product[] = [];

  setProducts(products: Product[]) {
    this.products = products;
  }

  clear() {
    this.products = [];
  }

  getAll(): Product[] {
    return this.products;
  }

  getByCategory(category: string): Product[] {
    const keywords = CATEGORY_KEYWORDS[category] || [category];
    
    return this.products.filter((p) => {
      const searchText = [
        p.title,
        p.description,
        p.productType,
        p.tags,
        p.vendor
      ].filter(Boolean).join(' ').toLowerCase();
      
      return keywords.some(keyword => searchText.includes(keyword.toLowerCase()));
    });
  }
  
  // Get wellness category for a product
  detectCategory(product: Product): string | null {
    const searchText = [
      product.title,
      product.description,
      product.productType,
      product.tags
    ].filter(Boolean).join(' ').toLowerCase();
    
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some(keyword => searchText.includes(keyword.toLowerCase()))) {
        return category;
      }
    }
    return null;
  }

  getCategories(): string[] {
    const categories = new Set<string>();

    this.products.forEach((p) => {
      if (p.category) categories.add(p.category);
      if (p.productType) categories.add(p.productType);
    });

    return Array.from(categories).filter(Boolean).sort();
  }

  search(query: string): Product[] {
    const queryLower = query.toLowerCase();
    return this.products.filter(
      (p) =>
        p.title?.toLowerCase().includes(queryLower) ||
        p.description?.toLowerCase().includes(queryLower) ||
        p.vendor?.toLowerCase().includes(queryLower) ||
        p.tags?.toLowerCase().includes(queryLower)
    );
  }

  getRecommendations(category: string, limit: number = 3): Product[] {
    const categoryProducts = this.getByCategory(category);

    // Prioritize products with images and prices
    const sorted = categoryProducts.sort((a, b) => {
      const aScore = (a.imageUrl ? 2 : 0) + (a.price ? 1 : 0);
      const bScore = (b.imageUrl ? 2 : 0) + (b.price ? 1 : 0);
      return bScore - aScore;
    });

    return sorted.slice(0, limit);
  }

  getCount(): number {
    return this.products.length;
  }
}

export const productStore = new ProductStore();

// ── DB-backed product recommendations for the revamp/generate pipeline ──
// Queries the `products` table and returns up to `limit` products matched to a
// collection/category. Mirrors the matching logic used elsewhere in PPW.
import { getSQL } from "@/lib/db";

export interface DBProduct {
  title: string;
  description?: string;
  price?: string;
  imageUrl?: string;
  handle?: string;
  vendor?: string;
  tags?: string;
  category?: string;
  productType?: string;
  id?: string;
  url?: string;
  compareAtPrice?: string;
}

export async function getProductRecommendationsFromDB(
  category: string,
  limit = 4
): Promise<DBProduct[]> {
  try {
    const sql = getSQL();
    const rows = (await sql`SELECT * FROM products ORDER BY title LIMIT 500`) as Record<string, unknown>[];
    if (!rows.length) return [];
    const all: DBProduct[] = rows.map((r) => ({
      title: String(r.title ?? ""),
      description: (r.description as string) ?? "",
      price: r.price != null ? String(r.price) : "",
      imageUrl: (r.image_url as string) ?? (r.imageurl as string) ?? "",
      handle: (r.handle as string) ?? "",
      vendor: (r.vendor as string) ?? "",
      tags: (r.tags as string) ?? "",
      category: (r.category as string) ?? (r.collection_slug as string) ?? "",
      productType: (r.product_type as string) ?? "",
    }));
    const cat = category.toLowerCase();
    const kw = category.replace(/-/g, " ").toLowerCase();
    const exact = all.filter((p) => (p.category || "").toLowerCase() === cat);
    const matched = exact.length
      ? exact
      : all.filter((p) =>
          [p.title, p.description, p.productType, p.tags, p.category, p.vendor]
            .filter(Boolean).join(" ").toLowerCase().includes(kw)
        );
    if (!matched.length) return [];
    const sorted = matched.sort((a, b) => {
      const s = (p: DBProduct) => (p.imageUrl ? 2 : 0) + (p.price && p.price !== "0" ? 1 : 0);
      return s(b) - s(a);
    });
    return sorted.slice(0, limit);
  } catch (err) {
    console.error("[product-store] getProductRecommendationsFromDB failed:", err);
    return [];
  }
}
