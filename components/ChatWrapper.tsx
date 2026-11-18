"use client";

import { useState } from "react";
import PPWChatPanel from "@/components/PPWChatPanel";

const SYSTEM_PROMPT = `You are the PPW Content Studio assistant for Peak Primal Wellness, a premium DTC wellness brand selling infrared saunas, cold plunges, red light therapy, hyperbaric chambers, barrel saunas, and hydrogen water systems.

You have DIRECT ACCESS to Content Studio's data and functionality through tools. You can search articles, browse collections, check products, generate content, publish to Shopify, and update existing articles.

USE YOUR TOOLS PROACTIVELY. When a user asks about articles, collections, or content — look it up instead of guessing. When they want to create or publish, use the tools to do it.

AVAILABLE CAPABILITIES:
- Search and fetch published Shopify articles (see content, tags, audit flags)
- List and filter collections from the database (by category, priority, optimization status)
- Browse the topical authority map and content resources
- Fetch Shopify products by category (with prices, images, availability)
- Generate new SEO articles (with Claude AI — specify title, keyword, category, type, audience, tone)
- Publish articles directly to the Shopify blog
- Update existing published articles (body, tags, title, summary)

WORKFLOW GUIDANCE:
- For article generation: help the user choose the right articleType (buyers-guide, comparison, how-to, listicle, benefit-deep-dive, brand-review, ultimate-guide), audience (general, enthusiast, athlete, first-time, professional), and tone (educational, authoritative, comparison)
- Always confirm with the user before generating or publishing — these are significant actions
- When reviewing articles, fetch them first so you can give specific feedback
- Key rule: Always reference real keyword data. Never invent keyword phrases.

COLLECTIONS: Infrared Saunas, Barrel Saunas, Cold Plunges, Red Light Therapy, Hyperbaric Chambers, Hydrogen Water, Water Ionizers, Sauna Heaters, Sensory Deprivation Tanks, Steam, Massage Equipment, Compression Boots.

The brand palette: primary green rgb(26, 122, 84), dark navy #003366.`;

export default function ChatWrapper() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="fixed bottom-5 right-5 z-50 flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95"
        style={{
          background: open ? "#374151" : "#1D9E75",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          borderRadius: open ? "50%" : "50%",
          // Closed: small circle icon. Open: slightly larger with X.
          width: open ? 40 : 36,
          height: open ? 40 : 36,
          boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
          flexShrink: 0,
        }}
        title={open ? "Close copilot" : "Open Content Studio Copilot"}
      >
        {open ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        )}
      </button>

      <div
        className="fixed top-0 right-0 z-40 h-full shadow-2xl transition-transform duration-300 ease-in-out"
        style={{
          width: 380,
          transform: open ? "translateX(0)" : "translateX(100%)",
          background: "#fff",
          borderLeft: "1px solid #e5e7eb",
        }}
      >
        {open && (
          <PPWChatPanel
            systemPrompt={SYSTEM_PROMPT}
            welcomeMessage={
              "Hey! I'm your Content Studio Copilot. I have direct access to your articles, collections, products, and can generate + publish content.\n\nTry: \"Show me our infrared sauna articles\" or \"What collections need optimization?\""
            }
            appName="Content Studio Copilot"
            placeholder="Search articles, generate content, publish…"
            height="100%"
          />
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/10 transition-opacity"
          onClick={() => setOpen(false)}
        />
      )}
    </>
  );
}
