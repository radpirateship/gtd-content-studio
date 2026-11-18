import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

// No fallback password — SITE_PASSWORD must be set in Vercel env vars.
export async function POST(request: NextRequest) {
  try {
    const sitePassword = process.env.SITE_PASSWORD;
    if (!sitePassword) {
      return NextResponse.json(
        { error: "SITE_PASSWORD is not configured. Set it in Vercel -> Settings -> Environment Variables, then redeploy." },
        { status: 503 }
      );
    }

    const { password } = await request.json();
    if (typeof password !== "string" || password.length > 200) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }

    const ok =
      password.length === sitePassword.length &&
      crypto.timingSafeEqual(Buffer.from(password), Buffer.from(sitePassword));

    if (!ok) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const token = crypto.createHash("sha256").update(`ppw-v2:${sitePassword}`).digest("hex");
    const response = NextResponse.json({ success: true });
    response.cookies.set("ppw-auth", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
