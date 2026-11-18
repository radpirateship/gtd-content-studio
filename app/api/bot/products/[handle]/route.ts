// app/api/bot/products/[handle]/route.ts
//
// GET /api/bot/products/<handle>   (read-only, Bearer token, JSON only)
// One product by its Shopify handle, with every CDN image URL.

import { type NextRequest, NextResponse } from "next/server";
import { botRequestAuthorized } from "@/lib/bot-auth";
import { fetchAdminProductsDetailed } from "@/lib/shopify/products-admin";
import { shapeForBot } from "@/lib/bot-products";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  if (!(await botRequestAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { handle } = await params;
  const clean = (handle || "").trim().toLowerCase();
  if (!clean) return NextResponse.json({ error: "handle is required" }, { status: 400 });

  const live = await fetchAdminProductsDetailed({ handle: clean, limit: 1 });
  if (!live.ok) return NextResponse.json({ error: "Shopify unavailable" }, { status: 502 });
  const product = live.products.find((p) => p.handle === clean) || live.products[0];
  if (!product) return NextResponse.json({ error: `No product with handle ${clean}` }, { status: 404 });
  return NextResponse.json({ product: shapeForBot(product), source: "shopify-admin-live" });
}
