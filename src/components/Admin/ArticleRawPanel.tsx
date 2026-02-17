'use client';

import type { RawArticle } from '@/lib/admin/types';

interface ArticleRawPanelProps {
  article: RawArticle | null;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="mb-3">
      <span
        className="text-[10px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: 'var(--text-faint)' }}
      >
        {label}
      </span>
      <div
        className="mt-0.5 text-sm leading-relaxed"
        style={{ color: value ? 'var(--text-primary)' : 'var(--text-faint)' }}
      >
        {value || '—'}
      </div>
    </div>
  );
}

export function ArticleRawPanel({ article }: ArticleRawPanelProps) {
  if (!article) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: 'var(--text-faint)' }}>
        No article selected
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 custom-scrollbar">
      <div className="mb-4 flex items-center gap-2">
        <span
          className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase"
          style={{
            background: 'rgba(8, 145, 178, 0.12)',
            color: 'var(--accent)',
          }}
        >
          Raw Input
        </span>
      </div>

      <Field label="Title" value={article.title} />
      <Field label="Date" value={article.date} />
      <Field label="City" value={article.city} />
      <Field label="Bundesland" value={article.bundesland} />
      <Field label="Source" value={article.source} />

      {article.url && (
        <div className="mb-3">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: 'var(--text-faint)' }}
          >
            URL
          </span>
          <div className="mt-0.5">
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm break-all"
              style={{ color: 'var(--accent)' }}
            >
              {article.url}
            </a>
          </div>
        </div>
      )}

      <div className="mb-3">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: 'var(--text-faint)' }}
        >
          Body
        </span>
        <div
          className="mt-1 whitespace-pre-wrap rounded-lg border p-3 text-sm leading-relaxed"
          style={{
            borderColor: 'var(--border-inner)',
            background: 'var(--card-inner)',
            color: 'var(--text-secondary)',
          }}
        >
          {article.body || '(empty)'}
        </div>
      </div>
    </div>
  );
}
