# Collection Improve — 14 Verifiable Tasks (Ryan, July 28 2026)
Source of truth for the deterministic enforcement pass (lib/collection-task-enforcer.ts).
Each task = explicit check + explicit action on failure. See chat for full wording.
1. FAQ Q1 = "What is the best [keyword]?" (+ schema sync)
2. FAQ Q2 = brand comparison naming carried brands (+ schema sync)
3. Intro: brands in first two sentences + price anchor from live low price
4. Bullets: exactly six, colon labels, six slots in order
5. BreadcrumbList in @graph (Home + collection)
6. ItemList = the 4 featured products, exact URLs, no dup-handle suffixes
7. Care: exactly "Cleaning and Daily Care" / "Routine Maintenance" / "Warranty Coverage" H3s, keep wrappers
8. Remove comparison table (and its nav link) when buying guide exists
9. Buying guide card headings start with action verbs
10. Buying guide cards: exactly three bullets each
11. Every featured/product tile has "View Product Details →" CTA
12. Learning section heading begins with "Complete"
13. Exactly ONE ld+json script tag (single @graph)
14. Em dashes only in H2 subheadings

---
## Result log
- Pass 1 (rules-as-guidance prompt): 5.5/10 — appended sections, wrong classes, schema duplication
- Pass 2 (section-replacement engine): partial — Q1 corruption ($-substitution bug), 1/4 CTAs, orphaned nav link
- Pass 3 (14 discrete check→fix→verify tasks + deterministic enforcement): **9/10, 14/14 tasks green** across three collections

## Architecture lesson (July 28 2026)
"Here are the rules, optimize this page" fails. "Run task 1, check, fix, verify; run task 2..." works.
The improvement came from: (1) discrete verifiable tasks with explicit checks, (2) deterministic
enforcement that never trusts AI compliance, (3) full-overwrite replacements (function-form only —
string replacements corrupt on $ in prices), (4) paired operations (section + nav link), and
(5) honest per-task verdicts instead of silent skips.
