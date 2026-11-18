"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Invalid password");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a" }}>
      <form onSubmit={handleSubmit} style={{ background: "#fff", padding: "2.5rem", borderRadius: 12, width: 360, boxShadow: "0 10px 30px rgba(0,0,0,0.3)" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: "#0f172a" }}>PPW Content Studio v2</h1>
        <p style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>Enter the site password to continue.</p>
        <label htmlFor="site-password" style={{ fontSize: 12, fontWeight: 600, color: "#334155", display: "block", marginBottom: 6 }}>
          Password
        </label>
        <input
          id="site-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          style={{ width: "100%", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, marginBottom: 12, boxSizing: "border-box" }}
        />
        {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
        <button
          type="submit"
          disabled={loading || !password}
          style={{ width: "100%", padding: "10px 12px", background: "#0066cc", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: loading ? "wait" : "pointer", opacity: loading || !password ? 0.7 : 1 }}
        >
          {loading ? "Checking..." : "Enter"}
        </button>
      </form>
    </div>
  );
}
