# Design Studio Templates (July 29 2026)
Source: Ryan's Claude Design Studio session ("GTD Collection Templates.html" React bundle — HTML extracted from the JS string literal).

- category-template.html: overview, picks, guide, compare, benefits, brands, space, ownership, learn, faq
- brand-template.html: why, lineup, tiers, fit, certs, story, bownership (brand ownership), bfaq (brand faq), related
- Styling: 100% inline styles, Poppins (theme already loads it — used on live PDPs), gold system #c8a96e/#8a6d2f text, cream #faf7f1 alt sections, navy #09195B headings/CTAs.

INTEGRATION GOTCHAS
1. `style-hover="..."` attributes are NOT real HTML — the bundler's hover encoding. Must become real CSS :hover rules, which requires classes on interactive cards. Plan: keep static styling inline, add a thin gtd- class layer ONLY for hover/interactive states, defined once in the carried <style> block.
2. `sc-camel-view-box` svg attr already fixed to viewBox in these files.
3. Placeholder content throughout (product shots, "34 models", SaunaLife examples) — assemblePage must feed real data into these slots.
4. FAQ section here must keep the .faq-modern behavior (details/summary) — the design's faq section markup needs mapping onto the working accordion.
