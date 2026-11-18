// Listed specs for the Video Scripts generator.
//
// Every number a script says must exist in a listed spec or price, or be a
// value derived here in code. So specs are pulled straight from the product
// page (spec tables, list items, "Label: value" lines, included / sold
// separately sentences), Shopify metafields and live prices, each with the
// exact source text and URL. Derived values (price differences, per-seat
// price) are computed here, never by the model.
import type { ProductDetail } from "./shopify";
import { htmlToText } from "./text";
import type { Spec } from "./types";

type Candidate = Omit<Spec, "id">;

const decode = (s: string) =>
  s
    .replace(/&nbsp;| /g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&deg;/g, "°")
    .replace(/&times;/g, "x")
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const UNIT_RE =
  /(cu\.?\s?ft|cubic feet|sq\.?\s?ft|kw|w|watts?|v|volts?|amps?|a|hz|°\s?f|°\s?c|f|c|in|inches|"|ft|feet|mm|cm|m|lbs?|pounds?|kg|gal|gallons?|l|liters?|hp|psi|ata|nm|mph|person|people|persons|seats?|years?|yr|minutes?|min|hours?|hrs?)\b/i;

function unitOf(value: string): string {
  const m = value.match(new RegExp(`\\d[\\d,.]*\\s*(?:-|to|–)?\\s*\\d*[\\d,.]*\\s*${UNIT_RE.source}`, "i"));
  if (!m) return "";
  const u = m[0].match(UNIT_RE);
  return u ? u[0] : "";
}

const money = (v: string | number) =>
  `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function fromDescription(p: ProductDetail): Candidate[] {
  const html = p.descriptionHtml || "";
  const out: Candidate[] = [];
  const base = { product: p.title, derived: false, formula: null, sourceUrl: p.url };

  // Spec tables: first cell label, second cell value.
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => strip(c[1])).filter(Boolean);
    if (cells.length < 2) continue;
    const [label, ...rest] = cells;
    const value = rest.join(" / ");
    if (label.length > 60 || value.length > 160) continue;
    out.push({ ...base, label, value, unit: unitOf(value), sourceText: `${label}: ${value}` });
  }

  // List items: "Label: value" or a bare line.
  for (const li of html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = strip(li[1]);
    if (!text || text.length > 200) continue;
    const m = text.match(/^([^:]{2,50}):\s*(.+)$/);
    if (m) out.push({ ...base, label: m[1].trim(), value: m[2].trim(), unit: unitOf(m[2]), sourceText: text });
    else out.push({ ...base, label: "Listed feature", value: text, unit: unitOf(text), sourceText: text });
  }

  // Plain "Label: value" lines with a number, outside lists and tables.
  const text = htmlToText(html.replace(/<table[\s\S]*?<\/table>/gi, " ").replace(/<ul[\s\S]*?<\/ul>/gi, " "));
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z][A-Za-z0-9 /()&.-]{1,40}):\s*(.{1,140})$/);
    if (m && /\d/.test(m[2])) out.push({ ...base, label: m[1].trim(), value: m[2].trim(), unit: unitOf(m[2]), sourceText: line });
  }

  // What's included / sold separately sentences.
  for (const sentence of text.split(/(?<=[.!?])\s+|\n/)) {
    const s = sentence.trim();
    if (s.length < 8 || s.length > 220) continue;
    if (/sold separately|not included|does not include|doesn't include|purchased separately|required \(not included\)/i.test(s)) {
      out.push({ ...base, label: "Not included", value: s, unit: "", sourceText: s });
    } else if (/\b(includes?|included|comes with|what's in the box)\b/i.test(s)) {
      out.push({ ...base, label: "Included", value: s, unit: "", sourceText: s });
    }
  }
  return out;
}

function fromStore(p: ProductDetail): Candidate[] {
  const base = { product: p.title, derived: false, formula: null, sourceUrl: p.url };
  const out: Candidate[] = [];
  if (p.price) {
    const onSale = p.compareAtPrice && Number(p.compareAtPrice) > Number(p.price);
    out.push({
      ...base,
      label: "Price",
      value: money(p.price),
      unit: "USD",
      sourceText: onSale
        ? `Sale price ${money(p.price)} (regular ${money(p.compareAtPrice!)}), live Shopify price`
        : `Regular price ${money(p.price)}, live Shopify price`,
    });
    if (onSale) {
      out.push({ ...base, label: "Regular price", value: money(p.compareAtPrice!), unit: "USD", sourceText: `Compare-at price ${money(p.compareAtPrice!)}, live Shopify price` });
    }
  }
  if (p.variants.length > 1 && p.variants.length <= 12) {
    for (const v of p.variants) {
      out.push({ ...base, label: `Option: ${v.title}`, value: money(v.price), unit: "USD", sourceText: `Variant "${v.title}" ${money(v.price)}, live Shopify price` });
    }
  }
  if (p.vendor) out.push({ ...base, label: "Brand", value: p.vendor, unit: "", sourceText: `Vendor: ${p.vendor}` });
  for (const m of p.metafields) {
    const value = decode(m.value).replace(/^\[|\]$/g, "").replace(/"/g, "").trim();
    if (!value || value.length > 160) continue;
    const label = m.key.replace(/_/g, " ");
    out.push({ ...base, label, value, unit: unitOf(value), sourceText: `${label}: ${value} (Shopify metafield ${m.namespace}.${m.key})` });
  }
  return out;
}

function dedupe(list: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = `${c.product}|${c.label.toLowerCase()}|${c.value.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const MAX_PER_PRODUCT = 60;

/** Specs for 1 to 3 products, ids assigned in order, plus derived values. */
export function buildSpecPack(products: ProductDetail[], extra: Candidate[] = []): Spec[] {
  const listed: Candidate[] = [];
  for (const p of products) {
    // Store facts first (price, brand) so they always survive the cap.
    listed.push(...dedupe([...fromStore(p), ...fromDescription(p)]).slice(0, MAX_PER_PRODUCT));
  }
  listed.push(...extra);
  const specs: Spec[] = listed.map((c, i) => ({ ...c, id: `s${i + 1}` }));

  // Derived values, computed in code.
  const derived: Candidate[] = [];
  const priced = products.filter((p) => p.price && Number(p.price) > 0);
  for (let i = 0; i < priced.length; i++) {
    for (let j = i + 1; j < priced.length; j++) {
      const a = priced[i], b = priced[j];
      const diff = Math.abs(Number(a.price) - Number(b.price));
      const [hi, lo] = Number(a.price) >= Number(b.price) ? [a, b] : [b, a];
      derived.push({
        product: `${hi.title} vs ${lo.title}`,
        label: "Price difference",
        value: money(Math.round(diff)),
        unit: "USD",
        derived: true,
        formula: `${money(hi.price!)} - ${money(lo.price!)}`,
        sourceUrl: hi.url,
        sourceText: `Computed from listed prices: ${hi.title} ${money(hi.price!)}, ${lo.title} ${money(lo.price!)}`,
      });
    }
  }
  for (const p of products) {
    if (p.variants.length < 2 || p.variants.length > 6) continue;
    const prices = p.variants.map((v) => Number(v.price)).filter((n) => n > 0);
    const min = Math.min(...prices);
    for (const v of p.variants) {
      const d = Number(v.price) - min;
      if (d <= 0) continue;
      derived.push({
        product: p.title,
        label: `Extra cost of "${v.title}" over the cheapest option`,
        value: money(Math.round(d)),
        unit: "USD",
        derived: true,
        formula: `${money(v.price)} - ${money(min)}`,
        sourceUrl: p.url,
        sourceText: `Computed from variant prices on ${p.title}`,
      });
    }
  }
  for (const p of priced) {
    // Per-seat price when the page lists a person / seat capacity.
    const cap = specs.find((s) => s.product === p.title && /person|people|seat|capacity|occupan/i.test(`${s.label} ${s.value}`) && /\d/.test(s.value));
    const n = cap ? Number((cap.value.match(/(\d+)\s*(?:-|to)?\s*(\d+)?\s*(?:person|people|seat)/i) || [])[2] || (cap.value.match(/(\d+)/) || [])[1]) : 0;
    if (n && n > 0 && n < 20) {
      derived.push({
        product: p.title,
        label: "Price per seat",
        value: money(Math.round(Number(p.price) / n)),
        unit: "USD",
        derived: true,
        formula: `${money(p.price!)} / ${n} seats (from "${cap!.sourceText}")`,
        sourceUrl: p.url,
        sourceText: `Computed: listed price divided by listed capacity`,
      });
    }
  }
  return [...specs, ...derived.map((d, i) => ({ ...d, id: `d${i + 1}` }))];
}

/** Every number that appears in the spec pack, normalised (commas dropped). */
export function allowedNumbers(specs: Spec[]): Set<number> {
  const out = new Set<number>();
  for (const s of specs) {
    for (const m of `${s.value} ${s.sourceText}`.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const n = Number(m[0].replace(/,/g, ""));
      if (!Number.isNaN(n)) {
        out.add(n);
        if (n >= 1000) out.add(Math.round(n / 100) / 10); // "$4.4k" style
      }
    }
  }
  return out;
}
