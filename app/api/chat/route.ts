import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Tool definitions — maps to Content Studio's existing API routes
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "search_articles",
    description:
      "Search published Shopify articles by keyword or tag. Returns title, handle, URL, and content flags (has_image, has_faq, has_internal_links, has_products).",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search keyword (title match)" },
        tag: { type: "string", description: "Exact tag to filter by (e.g. 'Cold Plunges')" },
      },
    },
  },
  {
    name: "fetch_article",
    description:
      "Fetch a single published article's full content by handle or Shopify ID. Returns title, body_html, tags, metafields, featured image.",
    input_schema: {
      type: "object" as const,
      properties: {
        handle: { type: "string", description: "Article handle (URL slug)" },
        id: { type: "string", description: "Shopify article ID" },
      },
    },
  },
  {
    name: "list_collections",
    description:
      "List PPW collections from the database. Can filter by search term, category, priority, or optimization status. Returns slug, category, primary_keyword, search_volume, title_tag, priority.",
    input_schema: {
      type: "object" as const,
      properties: {
        search: { type: "string", description: "Search term for collection name/slug" },
        category: { type: "string", description: "Filter by category (e.g. 'Infrared Saunas')" },
        priority: { type: "string", description: "Filter by priority: high, medium, low" },
        optimized: { type: "string", description: "'true' or 'false' to filter by optimization status" },
      },
    },
  },
  {
    name: "list_articles",
    description:
      "List articles stored in the database. Can filter by category, type, or keyword. Returns title, category, word_count, published status.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: { type: "string", description: "Filter by category" },
        type: { type: "string", description: "Filter by article type" },
        keyword: { type: "string", description: "Filter by keyword" },
      },
    },
  },
  {
    name: "get_products",
    description:
      "Fetch Shopify products by category. Returns product titles, handles, prices, images, and availability. Sorted by best-selling.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          description:
            "Product category (e.g. 'Infrared Saunas', 'Cold Plunges', 'Red Light Therapy', 'Hyperbaric Chambers', 'Hydrogen Water')",
        },
      },
      required: ["category"],
    },
  },
  {
    name: "get_resources",
    description:
      "Fetch topical authority map or collection resources. Use type='summary' to see counts by collection, or type='topical-authority' for content pillars and keywords.",
    input_schema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          description: "'topical-authority', 'collections', or 'summary'",
        },
        collection: { type: "string", description: "Filter by collection slug" },
      },
      required: ["type"],
    },
  },
  {
    name: "generate_article",
    description:
      "Generate a new SEO article using AI. Returns the generated HTML body and FAQ content. IMPORTANT: Confirm with the user before generating — this uses API credits.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Article title" },
        keyword: { type: "string", description: "Primary SEO keyword" },
        category: {
          type: "string",
          description: "Product category (e.g. 'Infrared Saunas')",
        },
        articleType: {
          type: "string",
          description:
            "Type: buyers-guide, comparison, how-to, listicle, benefit-deep-dive, brand-review, ultimate-guide",
        },
        audience: {
          type: "string",
          description: "Target audience: general, enthusiast, athlete, first-time, professional",
        },
        tone: {
          type: "string",
          description: "Tone: educational, authoritative, comparison",
        },
        wordCount: { type: "number", description: "Target word count (default: 2000-2500)" },
      },
      required: ["title", "keyword", "category", "articleType"],
    },
  },
  {
    name: "publish_article",
    description:
      "Publish an article to the Shopify blog. IMPORTANT: Always confirm with the user before publishing. Requires the full article HTML, title, and tags.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Article title" },
        body_html: { type: "string", description: "Full article HTML body" },
        tags: { type: "string", description: "Comma-separated tags" },
        summary_html: { type: "string", description: "Article excerpt/summary" },
      },
      required: ["title", "body_html"],
    },
  },
  {
    name: "update_article",
    description:
      "Update an existing published Shopify article. Can update body_html, tags, title, or summary. Requires the Shopify article ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        shopifyArticleId: { type: "string", description: "Shopify article ID" },
        blogId: { type: "string", description: "Shopify blog ID (optional, auto-resolved)" },
        body_html: { type: "string", description: "Updated HTML body" },
        tags: { type: "string", description: "Updated tags" },
        title: { type: "string", description: "Updated title" },
        summary_html: { type: "string", description: "Updated excerpt" },
      },
      required: ["shopifyArticleId"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool executor — calls internal API routes
// ---------------------------------------------------------------------------

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  baseUrl: string
): Promise<string> {
  try {
    let url: string;
    let options: RequestInit = {};

    switch (name) {
      case "search_articles": {
        const params = new URLSearchParams();
        if (input.query) params.set("q", String(input.query));
        if (input.tag) params.set("tag", String(input.tag));
        url = `${baseUrl}/api/shopify/blog/search?${params}`;
        break;
      }
      case "fetch_article": {
        const params = new URLSearchParams();
        if (input.handle) params.set("handle", String(input.handle));
        if (input.id) params.set("id", String(input.id));
        url = `${baseUrl}/api/shopify/blog/fetch?${params}`;
        break;
      }
      case "list_collections": {
        const params = new URLSearchParams();
        if (input.search) params.set("search", String(input.search));
        if (input.category) params.set("category", String(input.category));
        if (input.priority) params.set("priority", String(input.priority));
        if (input.optimized) params.set("optimized", String(input.optimized));
        url = `${baseUrl}/api/collections?${params}`;
        break;
      }
      case "list_articles": {
        const params = new URLSearchParams();
        if (input.category) params.set("category", String(input.category));
        if (input.type) params.set("type", String(input.type));
        if (input.keyword) params.set("keyword", String(input.keyword));
        url = `${baseUrl}/api/articles?${params}`;
        break;
      }
      case "get_products": {
        url = `${baseUrl}/api/shopify/products?category=${encodeURIComponent(String(input.category))}`;
        break;
      }
      case "get_resources": {
        const params = new URLSearchParams();
        params.set("type", String(input.type));
        if (input.collection) params.set("collection", String(input.collection));
        url = `${baseUrl}/api/resources?${params}`;
        break;
      }
      case "generate_article": {
        url = `${baseUrl}/api/generate`;
        options = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        };
        break;
      }
      case "publish_article": {
        url = `${baseUrl}/api/shopify/blog/publish`;
        options = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        };
        break;
      }
      case "update_article": {
        url = `${baseUrl}/api/shopify/blog/update`;
        options = {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shopifyArticleId: input.shopifyArticleId,
            blogId: input.blogId,
            fields: {
              ...(input.body_html && { body_html: input.body_html }),
              ...(input.tags && { tags: input.tags }),
              ...(input.title && { title: input.title }),
              ...(input.summary_html && { summary_html: input.summary_html }),
            },
          }),
        };
        break;
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }

    const res = await fetch(url, options);
    const data = await res.json();

    // Truncate very large responses to avoid token overflow
    const stringified = JSON.stringify(data);
    if (stringified.length > 12000) {
      // Return a summary for large payloads
      if (Array.isArray(data)) {
        return JSON.stringify({
          _truncated: true,
          count: data.length,
          first_5: data.slice(0, 5),
          message: `Showing 5 of ${data.length} results. Ask me to narrow the search if you need specific items.`,
        });
      }
      return stringified.slice(0, 12000) + "\n...[truncated]";
    }
    return stringified;
  } catch (err) {
    return JSON.stringify({ error: `Tool execution failed: ${err}` });
  }
}

// ---------------------------------------------------------------------------
// Main chat handler — orchestrates Claude + tool calls
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const { system, messages } = await req.json();
  const baseUrl = new URL(req.url).origin;
  const apiKey = process.env.ANTHROPIC_API_KEY!;

  // Build initial request to Claude with tools
  let currentMessages = [...messages];
  const maxToolRounds = 5; // Safety limit

  for (let round = 0; round < maxToolRounds; round++) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system,
        messages: currentMessages,
        tools: TOOLS,
      }),
    });

    if (!response.ok) {
      const errData = await response.json();
      return NextResponse.json(errData, { status: response.status });
    }

    const data = await response.json();

    // If stop_reason is "end_turn" or no tool calls, return the response
    if (data.stop_reason === "end_turn" || !data.content.some((b: { type: string }) => b.type === "tool_use")) {
      return NextResponse.json(data);
    }

    // Process tool calls
    const toolUseBlocks = data.content.filter((b: { type: string }) => b.type === "tool_use");
    const toolResults = [];

    for (const toolBlock of toolUseBlocks) {
      const result = await executeTool(toolBlock.name, toolBlock.input, baseUrl);
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolBlock.id,
        content: result,
      });
    }

    // Add assistant message and tool results to conversation
    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: data.content },
      { role: "user", content: toolResults },
    ];
  }

  // If we hit max rounds, return what we have
  return NextResponse.json({
    content: [{ type: "text", text: "I reached the maximum number of tool calls. Please try a more specific question." }],
  });
}
