import { parseShopifyDomain } from "./parse-shopify-domain";
import { withRetry } from "../retry";

const SHOPIFY_API_VERSION = "2025-10";
const SHOPIFY_TIMEOUT_MS = 15_000;

type StorefrontImage = {
  url: string;
  altText: string | null;
};

type StorefrontAuthor = {
  name?: string | null;
} | null;

type BlogsResponse = {
  blogs: {
    nodes: StorefrontBlogSummary[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type StorefrontArticleNode = {
  id: string;
  title: string;
  handle: string;
  tags: string[];
  contentHtml: string;
  excerptHtml: string | null;
  publishedAt: string | null;
  onlineStoreUrl: string | null;
  image: StorefrontImage | null;
  authorV2: StorefrontAuthor;
  blog: StorefrontBlogSummary;
};

type ArticleByIdResponse = {
  article: StorefrontArticleNode | null;
};

type ArticlesResponse = {
  articles: {
    nodes: StorefrontArticleNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

export type StorefrontBlogSummary = {
  handle: string;
  title: string;
};

export type StorefrontArticle = {
  id: string;
  legacyId: number | null;
  title: string;
  handle: string;
  tags: string[];
  contentHtml: string;
  excerptHtml: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  onlineStoreUrl: string | null;
  image: StorefrontImage | null;
  author: StorefrontAuthor;
  blog: StorefrontBlogSummary;
};

function getStorefrontConfig() {
  const rawDomain =
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    "";

  if (!rawDomain) {
    throw new Error(
      "SHOPIFY_STORE_DOMAIN (or NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN) is not set. " +
        "Add your store domain and a read-only Storefront token to use Shopify blog sync."
    );
  }

  const domain = parseShopifyDomain(rawDomain);
  const token = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || "";

  if (!token) {
    throw new Error(
      "SHOPIFY_STOREFRONT_ACCESS_TOKEN is not set. Create a Storefront token with unauthenticated_read_content."
    );
  }

  return {
    domain,
    token,
    url: `https://${domain}/api/${SHOPIFY_API_VERSION}/graphql.json`,
  };
}

async function storefrontFetch<T>({
  query,
  variables = {},
}: {
  query: string;
  variables?: Record<string, unknown>;
}): Promise<T> {
  const { url, token } = getStorefrontConfig();

  return withRetry(
    async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SHOPIFY_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Storefront-Access-Token": token,
          },
          body: JSON.stringify({ query, variables }),
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Shopify Storefront API HTTP ${response.status}: ${body.slice(0, 200)}`);
        }

        const json = await response.json();
        if (json.errors?.length) {
          throw new Error(`Shopify Storefront GraphQL error: ${JSON.stringify(json.errors)}`);
        }

        return json.data as T;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`Shopify Storefront API request timed out after ${SHOPIFY_TIMEOUT_MS / 1000}s`);
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    { label: "Shopify Storefront blog", maxRetries: 2 }
  );
}

function extractLegacyId(gid: string | null | undefined) {
  if (!gid) return null;
  const match = gid.match(/\/(\d+)(?:\?.*)?$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeArticle(article: {
  id: string;
  title: string;
  handle: string;
  tags?: string[] | null;
  contentHtml?: string | null;
  excerptHtml?: string | null;
  publishedAt?: string | null;
  onlineStoreUrl?: string | null;
  image?: StorefrontImage | null;
  authorV2?: StorefrontAuthor;
  blog: StorefrontBlogSummary;
}): StorefrontArticle {
  return {
    id: article.id,
    legacyId: extractLegacyId(article.id),
    title: article.title,
    handle: article.handle,
    tags: article.tags || [],
    contentHtml: article.contentHtml || "",
    excerptHtml: article.excerptHtml || null,
    publishedAt: article.publishedAt || null,
    updatedAt: null,
    onlineStoreUrl: article.onlineStoreUrl || null,
    image: article.image || null,
    author: article.authorV2 || null,
    blog: article.blog,
  };
}

function formatSearchValue(value: string) {
  const escaped = value.trim().replace(/"/g, '\\"');
  return /[\s:]/.test(escaped) ? `"${escaped}"` : escaped;
}

export async function fetchStorefrontArticleById(id: string) {
  const data: ArticleByIdResponse = await storefrontFetch<ArticleByIdResponse>({
    query: `
      query ReadArticleById($id: ID!) {
        article(id: $id) {
          id
          title
          handle
          tags
          contentHtml
          excerptHtml
          publishedAt
          onlineStoreUrl
          image {
            url
            altText
          }
          authorV2 {
            name
          }
          blog {
            handle
            title
          }
        }
      }
    `,
    variables: { id },
  });

  return data.article ? normalizeArticle(data.article) : null;
}

export async function fetchStorefrontBlogs() {
  const blogs: StorefrontBlogSummary[] = [];
  let hasNextPage = true;
  let after: string | null = null;

  while (hasNextPage) {
    const data: BlogsResponse = await storefrontFetch<BlogsResponse>({
      query: `
        query ReadBlogs($after: String) {
          blogs(first: 100, after: $after, sortKey: HANDLE) {
            nodes {
              handle
              title
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      variables: { after },
    });

    blogs.push(...(data.blogs.nodes || []));
    hasNextPage = data.blogs.pageInfo.hasNextPage;
    after = data.blogs.pageInfo.endCursor;
  }

  return blogs;
}

export async function fetchStorefrontArticleByHandle(handle: string) {
  const blogs = await fetchStorefrontBlogs();
  if (blogs.length === 0) return null;

  const batchSize = 20;
  for (let i = 0; i < blogs.length; i += batchSize) {
    const batch = blogs.slice(i, i + batchSize);
    const selection = batch
      .map(
        (blog, index) => `
          b${index}: blog(handle: ${JSON.stringify(blog.handle)}) {
            handle
            title
            articleByHandle(handle: $handle) {
              id
              title
              handle
              tags
              contentHtml
              excerptHtml
              publishedAt
              onlineStoreUrl
              image {
                url
                altText
              }
              authorV2 {
                name
              }
              blog {
                handle
                title
              }
            }
          }
        `
      )
      .join("\n");

    const data = await storefrontFetch<Record<string, {
      handle: string;
      title: string;
      articleByHandle: {
        id: string;
        title: string;
        handle: string;
        tags: string[];
        contentHtml: string;
        excerptHtml: string | null;
        publishedAt: string | null;
        onlineStoreUrl: string | null;
        image: StorefrontImage | null;
        authorV2: StorefrontAuthor;
        blog: StorefrontBlogSummary;
      } | null;
    } | null>>({
      query: `
        query ReadArticleByHandle($handle: String!) {
          ${selection}
        }
      `,
      variables: { handle },
    });

    for (let index = 0; index < batch.length; index += 1) {
      const entry = data[`b${index}`];
      if (entry?.articleByHandle) {
        return normalizeArticle(entry.articleByHandle);
      }
    }
  }

  return null;
}

export async function searchStorefrontArticles({
  query,
  tag,
  limit = 50,
}: {
  query?: string | null;
  tag?: string | null;
  limit?: number;
}) {
  const searchQuery = tag?.trim()
    ? `tag:${formatSearchValue(tag)}`
    : query?.trim() || null;

  const data = await storefrontFetch<{
    articles: {
      nodes: StorefrontArticleNode[];
    };
  }>({
    query: `
      query SearchArticles($first: Int!, $query: String) {
        articles(first: $first, sortKey: RELEVANCE, query: $query) {
          nodes {
            id
            title
            handle
            tags
            contentHtml
            excerptHtml
            publishedAt
            onlineStoreUrl
            image {
              url
              altText
            }
            authorV2 {
              name
            }
            blog {
              handle
              title
            }
          }
        }
      }
    `,
    variables: { first: Math.min(Math.max(limit, 1), 100), query: searchQuery },
  });

  return (data.articles.nodes || []).map(normalizeArticle).slice(0, limit);
}

export async function fetchAllStorefrontArticles() {
  const articles: StorefrontArticle[] = [];
  let hasNextPage = true;
  let after: string | null = null;

  while (hasNextPage) {
    const data: ArticlesResponse = await storefrontFetch<ArticlesResponse>({
      query: `
        query ReadAllArticles($after: String) {
          articles(first: 100, after: $after, sortKey: UPDATED_AT, reverse: true) {
            nodes {
              id
              title
              handle
              tags
              contentHtml
              excerptHtml
              publishedAt
              onlineStoreUrl
              image {
                url
                altText
              }
              authorV2 {
                name
              }
              blog {
                handle
                title
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      variables: { after },
    });

    articles.push(...(data.articles.nodes || []).map(normalizeArticle));
    hasNextPage = data.articles.pageInfo.hasNextPage;
    after = data.articles.pageInfo.endCursor;
  }

  return articles;
}
