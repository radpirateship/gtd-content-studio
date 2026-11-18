import { type NextRequest, NextResponse } from "next/server";
import { buildFeaturedProductsSection } from "@/lib/product-card";

/**
 * POST /api/workshop/swap-products
 *
 * Replaces ONLY the featured-products section of an article with the exact
 * products the user picked (supports swapping in newer distributors' products
 * without touching any prose). If the article has no featured-products
 * section, one is inserted after the first section (post-overview).
 */

export async function POST(request: NextRequest) {
  try {
    const { bodyHtml, products, categoryLabel } = await request.json();

    if (!bodyHtml || !Array.isArray(products) || products.length === 0) {
      return NextResponse.json(
        { error: "bodyHtml and a non-empty products array are required" },
        { status: 400 }
      );
    }

    const section = buildFeaturedProductsSection(products, categoryLabel || "Wellness");

    const sectionRe = /<section id="featured-products"[\s\S]*?<\/section>/i;
    let html: string;
    let action: string;
    if (sectionRe.test(bodyHtml)) {
      html = bodyHtml.replace(sectionRe, section);
      action = "replaced";
    } else {
      // No existing block — insert after the first </section> (overview/hero).
      const firstSectionEnd = bodyHtml.indexOf("</section>");
      if (firstSectionEnd !== -1) {
        const at = firstSectionEnd + "</section>".length;
        html = bodyHtml.slice(0, at) + "\n" + section + bodyHtml.slice(at);
      } else {
        html = section + "\n" + bodyHtml;
      }
      action = "inserted";
    }

    return NextResponse.json({ html, action, productCount: Math.min(products.length, 4) });
  } catch (error) {
    console.error("[swap-products] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Product swap failed" },
      { status: 500 }
    );
  }
}
