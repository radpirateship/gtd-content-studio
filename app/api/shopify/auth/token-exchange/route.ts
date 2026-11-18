import { type NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

/**
 * Shopify OAuth Token Exchange (modern replacement for OAuth code grant callback).
 *
 * Why this exists: As of 2026, Shopify Dev Dashboard apps no longer trigger the
 * OAuth authorization code grant callback during install. Instead, installs route
 * through App Bridge, which issues a session JWT to the embedded app on each load.
 * This route accepts that JWT and exchanges it via Shopify's token-exchange grant
 * for an offline access token ("shpat_..."), which is what `lib/shopifyAuth.ts`
 * consumes from SHOPIFY_ACCESS_TOKEN.
 *
 * One-time use during access token rotation: the temporary client trigger in
 * `components/ShopifyTokenCapture.tsx` posts the session JWT here, the token is
 * logged with the prefix NEW_SHOPIFY_TOKEN, you copy it out of Vercel logs into
 * the SHOPIFY_ACCESS_TOKEN env var, then this route and the trigger get removed.
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionToken } = await request.json();

    if (!sessionToken || typeof sessionToken !== "string") {
      return NextResponse.json({ error: "Missing or invalid sessionToken" }, { status: 400 });
    }

    const apiKey = process.env.SHOPIFY_API_KEY || "";
    const apiSecret = process.env.SHOPIFY_API_SECRET || "";

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: "SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be set" },
        { status: 500 }
      );
    }

    // Verify the JWT — Shopify session tokens are HS256 signed with the app's API secret.
    const parts = sessionToken.split(".");
    if (parts.length !== 3) {
      return NextResponse.json({ error: "Invalid JWT format" }, { status: 401 });
    }
    const [headerB64, payloadB64, signatureB64] = parts;
    const expectedSig = crypto
      .createHmac("sha256", apiSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64url");
    if (expectedSig !== signatureB64) {
      return NextResponse.json({ error: "JWT signature verification failed" }, { status: 401 });
    }

    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));

    if (payload.aud !== apiKey) {
      return NextResponse.json(
        { error: "JWT aud does not match SHOPIFY_API_KEY" },
        { status: 401 }
      );
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return NextResponse.json({ error: "JWT expired" }, { status: 401 });
    }
    if (payload.nbf && payload.nbf > now + 10) {
      return NextResponse.json({ error: "JWT not yet valid" }, { status: 401 });
    }

    // dest claim is the shop origin (e.g. "https://green-thumb-depot.myshopify.com")
    const dest: string | undefined = payload.dest;
    if (!dest) {
      return NextResponse.json({ error: "JWT missing dest claim" }, { status: 401 });
    }
    const shop = new URL(dest).hostname;

    console.log("[shopify-token-exchange] Session token validated for shop:", shop);

    const exchangeRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: apiKey,
        client_secret: apiSecret,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: sessionToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
        requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
      }),
    });

    if (!exchangeRes.ok) {
      const errText = await exchangeRes.text();
      console.error(
        "[shopify-token-exchange] Exchange failed:",
        exchangeRes.status,
        errText
      );
      return NextResponse.json(
        { error: `Token exchange failed: ${errText}` },
        { status: exchangeRes.status }
      );
    }

    const data = await exchangeRes.json();
    const accessToken: string | undefined = data.access_token;
    const scope: string | undefined = data.scope;

    // One-shot capture log — remove this route after rotation completes.
    console.log("NEW_SHOPIFY_TOKEN:", accessToken);
    console.log(
      "[shopify-token-exchange] SUCCESS — captured offline access token. Preview:",
      accessToken ? accessToken.slice(0, 12) + "..." : "(empty)"
    );
    console.log("[shopify-token-exchange] Scopes:", scope);

    return NextResponse.json({ ok: true, scope, shop });
  } catch (err) {
    console.error("[shopify-token-exchange] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
