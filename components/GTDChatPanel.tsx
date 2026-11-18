"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface GTDChatPanelProps {
  systemPrompt: string;
  welcomeMessage?: string;
  placeholder?: string;
  contextLabel?: string;
  appName?: string;
  height?: string | number;
}

export default function GTDChatPanel({
  systemPrompt,
  welcomeMessage,
  placeholder = "Ask anything… (Enter to send)",
  contextLabel,
  appName = "GTD Assistant",
  height = "100%",
}: GTDChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(() =>
    welcomeMessage ? [{ role: "assistant", content: welcomeMessage }] : []
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  useEffect(() => {
    setMessages(welcomeMessage ? [{ role: "assistant", content: welcomeMessage }] : []);
  }, [welcomeMessage]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    const userMessage: Message = { role: "user", content: trimmed };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: systemPrompt,
          messages: updatedMessages,
        }),
      });
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      const text = data.content?.find((b: { type: string }) => b.type === "text")?.text ?? "";
      setMessages([...updatedMessages, { role: "assistant", content: text }]);
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height, background: "var(--color-background-primary, #fff)", borderLeft: "0.5px solid var(--color-border-tertiary, #e5e7eb)", fontFamily: "var(--font-sans, system-ui)" }}>
      <div style={{ padding: "12px 16px", borderBottom: "0.5px solid var(--color-border-tertiary, #e5e7eb)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#1D9E75", flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary, #111)" }}>{appName}</span>
        {contextLabel && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-text-secondary, #6b7280)", background: "var(--color-background-secondary, #f9fafb)", padding: "2px 7px", borderRadius: 20, border: "0.5px solid var(--color-border-tertiary, #e5e7eb)" }}>{contextLabel}</span>}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 && <p style={{ fontSize: 12, color: "var(--color-text-secondary, #6b7280)", textAlign: "center", marginTop: 24 }}>Start typing to get help</p>}
        {messages.map((msg, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start", gap: 3 }}>
            <span style={{ fontSize: 10, color: "var(--color-text-secondary, #6b7280)", paddingInline: 2 }}>{msg.role === "user" ? "You" : "Assistant"}</span>
            <div style={{ fontSize: 12, lineHeight: 1.55, padding: "8px 10px", borderRadius: 8, maxWidth: msg.role === "user" ? "85%" : "95%", whiteSpace: "pre-wrap", ...(msg.role === "user" ? { background: "var(--color-background-info, #eff6ff)", color: "var(--color-text-info, #1d4ed8)", borderBottomRightRadius: 3 } : { background: "var(--color-background-secondary, #f9fafb)", color: "var(--color-text-primary, #111)", borderBottomLeftRadius: 3 }) }}>
              {msg.content}
            </div>
          </div>
        ))}
        {loading && <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}><span style={{ fontSize: 10, color: "var(--color-text-secondary, #6b7280)", paddingInline: 2 }}>Assistant</span><div style={{ fontSize: 12, padding: "8px 10px", borderRadius: 8, borderBottomLeftRadius: 3, background: "var(--color-background-secondary, #f9fafb)", color: "var(--color-text-secondary, #6b7280)" }}>Thinking…</div></div>}
        {error && <p style={{ fontSize: 11, color: "var(--color-text-danger, #dc2626)", textAlign: "center" }}>{error}</p>}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: "10px 12px", borderTop: "0.5px solid var(--color-border-tertiary, #e5e7eb)", display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0 }}>
        <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder={placeholder} rows={1} style={{ flex: 1, fontSize: 12, padding: "7px 10px", border: "0.5px solid var(--color-border-secondary, #d1d5db)", borderRadius: 8, background: "var(--color-background-secondary, #f9fafb)", color: "var(--color-text-primary, #111)", resize: "none", fontFamily: "inherit", lineHeight: 1.4, outline: "none", minHeight: 34, maxHeight: 120, overflowY: "auto" }} />
        <button onClick={sendMessage} disabled={loading || !input.trim()} style={{ width: 32, height: 32, borderRadius: 8, background: loading || !input.trim() ? "var(--color-background-secondary, #f9fafb)" : "var(--color-background-info, #eff6ff)", border: "0.5px solid var(--color-border-secondary, #d1d5db)", cursor: loading || !input.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 6L10.5 1.5L7.5 6L10.5 10.5L1.5 6Z" fill={loading || !input.trim() ? "#9ca3af" : "#1d4ed8"} /></svg>
        </button>
      </div>
    </div>
  );
}
