'use client';

import { useState } from 'react';

interface FieldCommentProps {
  articleUrl: string;
  fieldPath: string;
  currentValue: string;
  onClose: () => void;
}

export function FieldComment({ articleUrl, fieldPath, currentValue, onClose }: FieldCommentProps) {
  const [comment, setComment] = useState('');
  const [suggestedFix, setSuggestedFix] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!comment.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article_url: articleUrl,
          field_path: fieldPath,
          comment_text: comment,
          suggested_fix: suggestedFix || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = typeof err.details === 'string' ? err.details : JSON.stringify(err.details);
        throw new Error(err.error || detail || `Failed to save (${res.status})`);
      }
      setSaved(true);
      setTimeout(onClose, 800);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      console.error('Comment save error:', msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="absolute right-0 top-full z-20 mt-1 w-72 rounded-xl border p-3 shadow-lg"
      style={{
        background: 'var(--card)',
        borderColor: 'var(--border)',
      }}
      onClick={e => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-faint)' }}>
          Comment on {fieldPath}
        </span>
        <button
          onClick={onClose}
          className="text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          ✕
        </button>
      </div>

      <div className="mb-2 rounded-md border px-2 py-1 text-xs" style={{ borderColor: 'var(--border-inner)', color: 'var(--text-muted)' }}>
        Current: {currentValue}
      </div>

      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="What's wrong with this value?"
        className="mb-2 w-full rounded-lg border px-2 py-1.5 text-sm"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--card-inner)',
          color: 'var(--text-primary)',
          resize: 'vertical',
        }}
        rows={2}
      />

      <input
        value={suggestedFix}
        onChange={e => setSuggestedFix(e.target.value)}
        placeholder="Suggested fix (optional)"
        className="mb-2 w-full rounded-lg border px-2 py-1.5 text-sm"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--card-inner)',
          color: 'var(--text-primary)',
        }}
      />

      {error && (
        <div className="mb-2 rounded-md px-2 py-1.5 text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          {error}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || saved || !comment.trim()}
        className="w-full rounded-lg py-1.5 text-sm font-medium transition-colors"
        style={{
          background: saved ? '#22c55e' : 'var(--accent)',
          color: '#fff',
          opacity: saving || !comment.trim() ? 0.5 : 1,
        }}
      >
        {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Comment'}
      </button>
    </div>
  );
}
