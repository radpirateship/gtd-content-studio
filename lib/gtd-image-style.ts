/**
 * Green Thumb Depot: global visual style suffix.
 * Appended to every image generation prompt for visual consistency.
 *
 * TODO(GTD palette): the brand palette has not been pulled from the Shopify
 * theme settings yet, so this block pins NO brand colours. It is deliberately
 * neutral until real hex tokens are available; when they are, add them here
 * as hex values (names like "leaf green" drift, hex codes do not). The font is
 * Inter, which is what the live storefront uses.
 */
export const GTD_GLOBAL_STYLE = `
---
VISUAL STYLE SETTINGS (STRICT ADHERENCE REQUIRED):
1.  **Overall Aesthetic:** Clean, modern, professional technical illustration or high-end editorial product photograph. Minimalist composition. No clutter.
2.  **Background:** Pure white (#FFFFFF) or a very light neutral grey. Clean, evenly lit environment for hero shots.
3.  **Colour:** Neutral palette. Dark charcoal for text and outlines, white for negative space, and at most one restrained accent colour used only to single something out.
4.  **Semantic Colours (diagrams only):** Blue for air, water and cooling flow; red for heat and warnings. Never decoration.
5.  **Typography (If Text is Present):** Inter, or a clean sans-serif of the same character. Semibold or bold for labels. No decorative fonts.
6.  **Subject Matter:** Equipment and plants shown accurately and at realistic scale in a clean grow room, processing room or studio setting. No people consuming cannabis, no smoke, no cartoon leaves, nothing styled to appeal to minors.
7.  **Forbidden Styles:** Do not use painterly, abstract, watercolor, messy sketch, or overly complex CGI styles. Do not use dark backgrounds. Do not use neon or saturated colours.
---
`;
