"use client"

// Self-contained Revamp flow orchestrator.
// Keeps all multi-step revamp state inside one component so the main
// app/page.tsx only needs a single <RevampWorkspace/> render block.
// Flow: backlog -> input -> analysis -> workshop.

import { useState } from "react"
import { RevampBacklogView } from "@/components/revamp-backlog-view"
import { RevampArticleView } from "@/components/revamp-article-view"
import { RevampAnalysisView } from "@/components/revamp-analysis-view"
import type { GeneratedArticle } from "@/lib/types"

type RevampView = "backlog" | "input" | "analysis" | "workshop"

function slugify(title: string): string {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96)
}

function buildSchemaMarkup(article: Partial<GeneratedArticle>): string {
  const faqs = (article as { faqs?: { question: string; answer: string }[] }).faqs || []
  if (!faqs.length) return ""
  const entities = faqs.map((f) => ({
    "@type": "Question",
    name: f.question,
    acceptedAnswer: { "@type": "Answer", text: f.answer },
  }))
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entities,
  })}</script>`
}

async function saveArticleToDb(article: GeneratedArticle): Promise<string | null> {
  try {
    const res = await fetch("/api/articles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(article),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.id ?? data?.article?.id ?? null
  } catch {
    return null
  }
}

export function RevampWorkspace({ onEditArticle }: { onEditArticle?: (handle: string) => void } = {}) {
  const [view, setView] = useState<RevampView>("backlog")
  const [selectedSource, setSelectedSource] = useState<any>(null)
  const [analysis, setAnalysis] = useState<any>(null)
  const [originalContent, setOriginalContent] = useState("")
  const [citations, setCitations] = useState<{ url: string; title?: string; notes?: string }[]>([])
  const [settings, setSettings] = useState<any>(null)
  const [article, setArticle] = useState<GeneratedArticle | null>(null)
  const [moduleDrafts, setModuleDrafts] = useState<any>(undefined)

  if (view === "backlog") {
    return (
      <RevampBacklogView
        onEditArticle={onEditArticle}
        onOpenRevamp={(source: any) => {
          setSelectedSource(source)
          setView("input")
        }}
      />
    )
  }

  if (view === "input") {
    return (
      <RevampArticleView
        initialSource={selectedSource}
        onAnalysisComplete={(a: any, content: string, cites: any[], s: any) => {
          setAnalysis(a)
          setOriginalContent(content)
          setCitations(cites)
          setSettings(s)
          setView("analysis")
        }}
      />
    )
  }

  if (view === "analysis" && analysis) {
    return (
      <RevampAnalysisView
        analysis={analysis}
        originalContent={originalContent}
        citations={citations.map((c) => ({ ...c, title: c.title || c.url }))}
        settings={settings}
        onGenerateComplete={(generated: GeneratedArticle, drafts?: any) => {
          setArticle(generated)
          if (drafts) setModuleDrafts(drafts)
          setView("workshop")
        }}
        onBack={() => setView("input")}
        onStartOver={() => {
          setAnalysis(null)
          setOriginalContent("")
          setCitations([])
          setSettings(null)
          setView("input")
        }}
        generateSlug={slugify}
        generateSchemaMarkup={buildSchemaMarkup}
        saveArticleToDb={saveArticleToDb}
      />
    )
  }

  if (view === "workshop" && article) {
    // Session 1: the in-app section workshop editor is deferred to session 2.
    // The revamped article has been generated and saved; edit/publish it from
    // the existing Articles library + editor for now.
    return (
      <div style={{ padding: "2.5rem", maxWidth: 640, margin: "0 auto" }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>Revamp generated</h2>
        <p style={{ fontSize: 14, color: "#475569", lineHeight: 1.6, marginBottom: 20 }}>
          The revamped article{article.title ? ` "${article.title}"` : ""} has been generated and saved as a draft.
          Open it from the Articles library to review, edit, and publish. The in-app revamp workshop editor is coming in the next session.
        </p>
        <button onClick={() => setView("backlog")} style={{ color: "#fff", background: "#0066cc", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: "pointer" }}>
          ← Back to Revamp Backlog
        </button>
      </div>
    )
  }

  // Fallback: nothing in progress
  return (
    <div style={{ padding: "2rem", color: "#666" }}>
      <p>Select an article from the Revamp Backlog to begin.</p>
      <button onClick={() => setView("backlog")} style={{ marginTop: 12, color: "#0066cc" }}>← Back to Backlog</button>
    </div>
  )
}
