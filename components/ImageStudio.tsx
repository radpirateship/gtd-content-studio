'use client';

import { useState, useRef, useEffect } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PromptCard {
  id: string;
  label: string;
  prompt: string;
  image: string | null;    // data URI when generated
  generating: boolean;
  error: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function downloadImage(dataUri: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUri;
  a.download = filename;
  a.click();
}

// ── Prompt card ───────────────────────────────────────────────────────────────

function PromptCardItem({
  card,
  useBrandStyle,
  onPromptChange,
  onGenerate,
  onRemove,
}: {
  card: PromptCard;
  useBrandStyle: boolean;
  onPromptChange: (id: string, prompt: string) => void;
  onGenerate: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      {/* Card header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: '1px solid #f3f4f6',
        background: '#fafafa',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{card.label}</span>
        <button
          onClick={() => onRemove(card.id)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
          title="Remove"
        >×</button>
      </div>

      {/* Prompt textarea */}
      <div style={{ padding: '12px 14px' }}>
        <textarea
          value={card.prompt}
          onChange={e => onPromptChange(card.id, e.target.value)}
          rows={4}
          style={{
            width: '100%', boxSizing: 'border-box',
            fontSize: 13, lineHeight: 1.6, color: '#111827',
            border: '1px solid #e5e7eb', borderRadius: 6,
            padding: '8px 10px', resize: 'vertical', outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        {useBrandStyle && (
          <div style={{ marginTop: 4, fontSize: 11, color: '#9ca3af' }}>
            + PPW brand style will be appended automatically
          </div>
        )}
      </div>

      {/* Generated image */}
      {card.image && (
        <div style={{ padding: '0 14px 14px' }}>
          <img
            src={card.image}
            alt={card.label}
            style={{ width: '100%', borderRadius: 8, display: 'block' }}
          />
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button
              onClick={() => downloadImage(card.image!, `${card.label.replace(/\s+/g, '-').toLowerCase()}.png`)}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 600,
                background: '#f3f4f6', color: '#374151',
                border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer',
              }}
            >
              ↓ Download
            </button>
            <button
              onClick={() => onGenerate(card.id)}
              disabled={card.generating}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 600,
                background: card.generating ? '#9ca3af' : '#f3f4f6',
                color: card.generating ? '#fff' : '#374151',
                border: '1px solid #e5e7eb', borderRadius: 6,
                cursor: card.generating ? 'not-allowed' : 'pointer',
              }}
            >
              {card.generating ? 'Regenerating…' : '↺ Regenerate'}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {card.error && (
        <div style={{ padding: '0 14px 12px', fontSize: 12, color: '#dc2626' }}>
          {card.error}
        </div>
      )}

      {/* Generate button (when no image yet) */}
      {!card.image && (
        <div style={{ padding: '0 14px 14px' }}>
          <button
            onClick={() => onGenerate(card.id)}
            disabled={card.generating || !card.prompt.trim()}
            style={{
              width: '100%', padding: '8px', fontSize: 13, fontWeight: 600,
              background: card.generating ? '#9ca3af' : '#1D9E75',
              color: '#fff', border: 'none', borderRadius: 6,
              cursor: card.generating || !card.prompt.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {card.generating ? '⟳ Generating image…' : '✦ Generate Image'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ImageStudio() {
  const [message, setMessage] = useState('');
  const [cards, setCards] = useState<PromptCard[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [useBrandStyle, setUseBrandStyle] = useState(false);
  const [generatingAll, setGeneratingAll] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount
  useEffect(() => { textareaRef.current?.focus(); }, []);

  // Draft prompts from Claude
  const handleDraft = async () => {
    if (!message.trim() || drafting) return;
    setDrafting(true);
    setDraftError('');

    try {
      const res = await fetch('/api/image-studio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prompts', message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate prompts');

      const newCards: PromptCard[] = (data.prompts || []).map((p: { id: string; label: string; prompt: string }) => ({
        id: p.id,
        label: p.label,
        prompt: p.prompt,
        image: null,
        generating: false,
        error: null,
      }));

      setCards(prev => [...prev, ...newCards]);
      setMessage('');
    } catch (err) {
      setDraftError(String(err));
    } finally {
      setDrafting(false);
    }
  };

  // Generate single image
  const handleGenerate = async (id: string) => {
    const card = cards.find(c => c.id === id);
    if (!card || card.generating) return;

    setCards(prev => prev.map(c => c.id === id ? { ...c, generating: true, error: null } : c));

    try {
      const res = await fetch('/api/image-studio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate', prompt: card.prompt, useBrandStyle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');

      setCards(prev => prev.map(c => c.id === id ? { ...c, image: data.image, generating: false } : c));
    } catch (err) {
      setCards(prev => prev.map(c => c.id === id ? { ...c, generating: false, error: String(err) } : c));
    }
  };

  // Generate all without images
  const handleGenerateAll = async () => {
    const pending = cards.filter(c => !c.image && !c.generating && c.prompt.trim());
    if (!pending.length || generatingAll) return;
    setGeneratingAll(true);
    // Fire sequentially to avoid rate-limit hammering
    for (const card of pending) {
      await handleGenerate(card.id);
    }
    setGeneratingAll(false);
  };

  const handlePromptChange = (id: string, prompt: string) => {
    setCards(prev => prev.map(c => c.id === id ? { ...c, prompt, image: null } : c));
  };

  const handleRemove = (id: string) => {
    setCards(prev => prev.filter(c => c.id !== id));
  };

  const pendingCount = cards.filter(c => !c.image && c.prompt.trim()).length;
  const generatedCount = cards.filter(c => c.image).length;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleDraft();
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Chat input area ── */}
      <div style={{
        padding: '24px 32px 20px',
        borderBottom: '1px solid #e5e7eb',
        background: '#fff',
        flexShrink: 0,
      }}>
        <div style={{ maxWidth: 800 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 4 }}>
            Image Studio
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
            Describe what you need — Claude will write the prompts, Gemini will generate the images.
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              ref={textareaRef}
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='e.g. "10 images of outdoor barrel saunas in different settings — beach, mountain, winter forest, desert, lakeside..."'
              rows={3}
              style={{
                flex: 1, boxSizing: 'border-box',
                fontSize: 14, lineHeight: 1.6, color: '#111827',
                border: '1px solid #d1d5db', borderRadius: 8,
                padding: '10px 14px', resize: 'none', outline: 'none',
                fontFamily: 'inherit',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              }}
              onFocus={e => { e.target.style.borderColor = '#1D9E75'; }}
              onBlur={e => { e.target.style.borderColor = '#d1d5db'; }}
            />
            <button
              onClick={handleDraft}
              disabled={drafting || !message.trim()}
              style={{
                padding: '10px 20px', fontSize: 13, fontWeight: 600,
                background: drafting || !message.trim() ? '#9ca3af' : '#1D9E75',
                color: '#fff', border: 'none', borderRadius: 8,
                cursor: drafting || !message.trim() ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap', height: 44, flexShrink: 0,
              }}
            >
              {drafting ? '⟳ Writing prompts…' : '✦ Write Prompts'}
            </button>
          </div>

          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Brand style toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none' }}>
              <div
                onClick={() => setUseBrandStyle(v => !v)}
                style={{
                  width: 36, height: 20, borderRadius: 10,
                  background: useBrandStyle ? '#1D9E75' : '#d1d5db',
                  position: 'relative', transition: 'background 0.2s', cursor: 'pointer', flexShrink: 0,
                }}
              >
                <div style={{
                  position: 'absolute', top: 2, left: useBrandStyle ? 18 : 2,
                  width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                }} />
              </div>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                PPW brand style {useBrandStyle ? <strong style={{ color: '#0F6E56' }}>ON</strong> : 'OFF'}
              </span>
            </label>

            <span style={{ fontSize: 12, color: '#9ca3af' }}>⌘+Enter to generate prompts</span>

            {draftError && (
              <span style={{ fontSize: 12, color: '#dc2626' }}>{draftError}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Cards area ── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>

        {cards.length === 0 && (
          <div style={{
            textAlign: 'center', paddingTop: 60, color: '#9ca3af',
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✦</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#6b7280', marginBottom: 6 }}>
              No images yet
            </div>
            <div style={{ fontSize: 13 }}>
              Describe what you need above and Claude will write the prompts for you
            </div>
          </div>
        )}

        {cards.length > 0 && (
          <>
            {/* Toolbar */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 20,
            }}>
              <div style={{ fontSize: 13, color: '#6b7280' }}>
                {cards.length} prompt{cards.length !== 1 ? 's' : ''}
                {generatedCount > 0 && <> · <span style={{ color: '#059669' }}>{generatedCount} generated</span></>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {pendingCount > 1 && (
                  <button
                    onClick={handleGenerateAll}
                    disabled={generatingAll}
                    style={{
                      padding: '7px 16px', fontSize: 12, fontWeight: 600,
                      background: generatingAll ? '#9ca3af' : '#1D9E75',
                      color: '#fff', border: 'none', borderRadius: 6,
                      cursor: generatingAll ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {generatingAll ? '⟳ Generating all…' : `✦ Generate all ${pendingCount}`}
                  </button>
                )}
                <button
                  onClick={() => setCards([])}
                  style={{
                    padding: '7px 16px', fontSize: 12, fontWeight: 600,
                    background: '#f3f4f6', color: '#6b7280',
                    border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer',
                  }}
                >
                  Clear all
                </button>
              </div>
            </div>

            {/* Masonry-style grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
              gap: 16,
              alignItems: 'start',
            }}>
              {cards.map(card => (
                <PromptCardItem
                  key={card.id}
                  card={card}
                  useBrandStyle={useBrandStyle}
                  onPromptChange={handlePromptChange}
                  onGenerate={handleGenerate}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
