// POST /api/video-scripts/generate  body: GenerateInput (lib/video-scripts/types.ts)
// Writes a draft script from live Shopify data, validates it against spec v2,
// and saves it. Nothing is published.
import { NextRequest, NextResponse } from "next/server";
import { generateScript } from "@/lib/video-scripts/generate";
import { LONG_LENGTH_MIN, SHORT_LENGTH, type GenerateInput } from "@/lib/video-scripts/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const TYPES = ["PRODUCT_REVIEW", "HOOK_ANGLE", "LONG_FORM"];

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Partial<GenerateInput>;
    if (!b.type || !TYPES.includes(b.type)) return NextResponse.json({ ok: false, error: "type is required" }, { status: 400 });
    if (!b.key || (b.kind !== "product" && b.kind !== "collection")) return NextResponse.json({ ok: false, error: "kind and key are required" }, { status: 400 });
    if (!Array.isArray(b.productIds) || !b.productIds.length) return NextResponse.json({ ok: false, error: "Pick at least one product" }, { status: 400 });
    if (!b.targetBuyer?.trim()) return NextResponse.json({ ok: false, error: "Target buyer is required" }, { status: 400 });

    const isLong = b.type === "LONG_FORM";
    const lengthSec = isLong
      ? Math.min(Math.max(Number(b.lengthSec) || LONG_LENGTH_MIN.default * 60, LONG_LENGTH_MIN.min * 60), LONG_LENGTH_MIN.max * 60)
      : Math.min(Math.max(Number(b.lengthSec) || SHORT_LENGTH.defaultA, SHORT_LENGTH.min), SHORT_LENGTH.max);

    const input: GenerateInput = {
      type: b.type,
      kind: b.kind,
      key: String(b.key),
      productIds: b.productIds.map(String).slice(0, 3),
      comparisonProductId: b.comparisonProductId ? String(b.comparisonProductId) : null,
      series: String(b.series || "GTD Honest Verdict"),
      hookType: b.hookType || null,
      targetBuyer: String(b.targetBuyer),
      lengthSec,
      assets: {
        photos: Number(b.assets?.photos) || 0,
        supplierVideo: Boolean(b.assets?.supplierVideo),
        licence: (["confirmed", "pending", "none"].includes(String(b.assets?.licence)) ? b.assets!.licence : "none") as GenerateInput["assets"]["licence"],
      },
      isBestSellerVerified: Boolean(b.isBestSellerVerified),
      manufacturerSpecs: b.manufacturerSpecs?.text ? { url: String(b.manufacturerSpecs.url || ""), text: String(b.manufacturerSpecs.text) } : null,
      angleType: b.angleType || null,
      angleStatement: b.angleStatement || null,
      citedStudy: b.citedStudy?.url && b.citedStudy?.finding ? b.citedStudy : null,
      chapterCount: isLong ? Math.min(Math.max(Number(b.chapterCount) || 5, 4), 8) : null,
      chapterQuestions: Array.isArray(b.chapterQuestions) ? b.chapterQuestions.map(String).filter(Boolean).slice(0, 8) : null,
      articleIds: Array.isArray(b.articleIds) ? b.articleIds.map(String) : null,
      notes: b.notes || null,
    };
    const result = await generateScript(input);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[video-scripts] generate failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
