// lib/bot-products.ts
// Response shape for the read-only /api/bot/products routes.

import type { AdminProductDetailed } from "@/lib/shopify/products-admin";

export function shapeForBot(p: AdminProductDetailed) {
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    url: p.url,
    status: p.status,
    vendor: p.vendor,
    productType: p.productType,
    type: p.productType,
    tags: p.tags,
    price: p.price,
    compareAtPrice: p.compareAtPrice,
    sku: p.sku,
    images: p.images,
    image: p.images[0] || null,
    updatedAt: p.updatedAt,
  };
}

