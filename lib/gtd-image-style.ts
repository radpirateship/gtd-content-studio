/**
 * Green Thumb Depot — Global Brand Visual Style Suffix
 * Appended to every image generation prompt for visual consistency.
 *
 * Palette is pinned to the blog/collection design system (gtd-blog.css,
 * gtd-collections.css). Every value here is a real token, not a description:
 * "soft gold" and "bright blue" drift, hex codes do not. If the design system
 * palette changes, change it here in the same commit.
 *
 * Navy corrected Aug 2026 from #0B1A5D to #09195B, which is the navy the site
 * actually uses. Red is not a brand colour but a diagram showing heat needs one,
 * so it is pinned and scoped to that single semantic job.
 */
export const GTD_GLOBAL_STYLE = `
---
VISUAL STYLE SETTINGS (STRICT ADHERENCE REQUIRED):
1.  **Overall Aesthetic:** Clean, modern, professional, technical illustration or high-end editorial photograph. Minimalist composition. No clutter.
2.  **Background:** Pure white (#FFFFFF), or the warm off-white (#FAF7F1) for diagrams that need a softer ground. Clean, well-lit environment for hero shots.
3.  **Primary Color Palette:**
    * **Dominant:** Deep Navy Blue (#09195B) for headers, main structures, professional elements.
    * **Neutral:** Dark charcoal (#12182B) for body text and outlines; clean White for negative space.
4.  **Accent Color Palette (Use Sparingly for Highlights):**
    * **Value/Premium/Success:** Muted Gold (#C8A96E) for glows, highlights and callout rules. This is the brand accent; use it where something is being singled out.
    * **Flow/Cool/Air:** Bright Blue (#0A86CB) arrows or highlights, e.g. air circulation, water flow.
    * **Action/Heat/Warning:** Red (#C0392B) arrows or highlights, e.g. heat rising. Heat and hazard only, never decoration.
5.  **Typography (If Text is Present):** Poppins, or a clean geometric sans-serif of the same character. Semibold or bold for labels. No decorative fonts.
6.  **Forbidden Styles:** Do not use painterly, abstract, watercolor, messy sketch, or overly complex CGI styles. Keep it clean and clinical. Do not use dark backgrounds. Do not use neon or saturated tech colours (electric blue, lime green) — they are not GTD colours.
---
`;
