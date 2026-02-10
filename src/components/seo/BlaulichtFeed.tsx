import type { CrimeRecord } from '@/lib/types/crime';
import { CRIME_CATEGORIES } from '@/lib/types/crime';

function getCategoryBadge(categories: string[]) {
  const cat = CRIME_CATEGORIES.find((c) => categories.includes(c.key));
  if (!cat) return null;
  return (
    <span
      className="inline-block text-xs px-2 py-0.5 rounded-full"
      style={{ backgroundColor: `${cat.color}22`, color: cat.color, border: `1px solid ${cat.color}44` }}
    >
      {cat.label}
    </span>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

interface BlaulichtFeedProps {
  records: CrimeRecord[];
  title?: string;
}

export function BlaulichtFeed({ records, title = 'Aktuelle Polizeimeldungen' }: BlaulichtFeedProps) {
  if (records.length === 0) {
    return (
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">{title}</h2>
        <p className="text-[var(--text-muted)] text-sm">Keine aktuellen Polizeimeldungen in diesem Gebiet.</p>
      </section>
    );
  }

  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">{title}</h2>
      <div className="space-y-3">
        {records.map((record) => (
          <article
            key={record.id}
            className="rounded-lg border border-[var(--card-border)] bg-[var(--card)]/50 p-4"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <h3 className="text-sm font-medium text-[var(--text-primary)] leading-snug">
                {record.cleanTitle || record.title}
              </h3>
              <time className="text-xs text-[var(--text-faint)] whitespace-nowrap shrink-0">
                {formatDate(record.publishedAt)}
              </time>
            </div>
            <div className="flex items-center gap-2">
              {getCategoryBadge(record.categories)}
              {record.locationText && (
                <span className="text-xs text-[var(--text-faint)]">{record.locationText}</span>
              )}
            </div>
            {record.summary && (
              <p className="text-xs text-[var(--text-muted)] mt-2 line-clamp-2">{record.summary}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
