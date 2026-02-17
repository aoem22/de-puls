'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { EnrichedArticle, RawArticle, EnrichmentVersion } from '@/lib/admin/types';
import { usePrompts, useEnrichmentVersions } from '@/lib/admin/hooks';
import { FieldComment } from './FieldComment';

interface AdminComment {
  id: string;
  field_path: string;
  comment_text: string;
  suggested_fix: string | null;
  status: string;
  created_at: string;
}

interface ArticleEnrichedPanelProps {
  articles: EnrichedArticle[];
  cacheEntry: unknown;
  articleUrl: string;
  rawArticle?: RawArticle;
}

// Classification badge color mapping
function classificationStyle(classification: string | undefined): { bg: string; color: string; label: string } {
  switch (classification?.toLowerCase()) {
    case 'junk':
      return { bg: 'rgba(239,68,68,0.12)', color: '#ef4444', label: 'JUNK' };
    case 'feuerwehr':
      return { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', label: 'FEUERWEHR' };
    case 'crime':
      return { bg: 'rgba(34,197,94,0.12)', color: '#22c55e', label: 'CRIME' };
    case 'update':
      return { bg: 'rgba(96,165,250,0.12)', color: '#60a5fa', label: 'UPDATE' };
    default:
      return { bg: 'rgba(148,163,184,0.12)', color: '#94a3b8', label: classification?.toUpperCase() || '?' };
  }
}

// Dot color for version tabs
function classificationDotColor(classification: string | undefined): string {
  switch (classification?.toLowerCase()) {
    case 'junk': return '#ef4444';
    case 'feuerwehr': return '#f59e0b';
    case 'crime': return '#22c55e';
    case 'update': return '#60a5fa';
    default: return '#94a3b8';
  }
}

// Extract classification from enriched data array
function getClassification(enrichedData: EnrichedArticle[]): string | undefined {
  return enrichedData?.[0]?.classification;
}

function ClassificationBadge({ classification, reason }: { classification: string; reason?: string }) {
  const style = classificationStyle(classification);
  return (
    <div className="mb-3">
      <span
        className="inline-block rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
        style={{ background: style.bg, color: style.color }}
      >
        {style.label}
      </span>
      {reason && (
        <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {reason}
        </p>
      )}
    </div>
  );
}

function confidenceColor(confidence: number | undefined): string {
  if (confidence == null) return 'var(--text-faint)';
  if (confidence >= 0.8) return '#22c55e';
  if (confidence >= 0.5) return '#f59e0b';
  return '#ef4444';
}

function FieldRow({
  label,
  value,
  fieldPath,
  articleUrl,
  confidence,
  comments,
  onCommentSaved,
  href,
}: {
  label: string;
  value: string | number | boolean | null | undefined;
  fieldPath: string;
  articleUrl: string;
  confidence?: number;
  comments?: AdminComment[];
  onCommentSaved?: () => void;
  href?: string;
}) {
  const [showComment, setShowComment] = useState(false);
  const displayValue = value == null ? '\u2014' : String(value);
  const hasValue = value != null && value !== '' && value !== false;
  const hasComments = comments && comments.length > 0;

  return (
    <div
      className="group relative flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--card-inner)] cursor-pointer"
      onClick={() => setShowComment(!showComment)}
    >
      <span
        className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          background: hasValue ? (confidence != null ? confidenceColor(confidence) : '#22c55e') : '#ef4444',
        }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: 'var(--text-faint)' }}
          >
            {label}
          </span>
          {hasComments && (
            <svg width="10" height="10" viewBox="0 0 16 16" fill="#f59e0b" className="shrink-0">
              <path d="M2.5 2A1.5 1.5 0 001 3.5v8.793a.5.5 0 00.854.353l2.853-2.853A1 1 0 015.414 9.5H12.5A1.5 1.5 0 0014 8V3.5A1.5 1.5 0 0012.5 2h-10z" />
            </svg>
          )}
        </div>
        <div
          className="text-sm"
          style={{ color: hasValue ? 'var(--text-primary)' : 'var(--text-faint)' }}
        >
          {href && hasValue ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
              style={{ color: 'var(--text-primary)' }}
            >
              {displayValue}
            </a>
          ) : (
            displayValue
          )}
        </div>
        {hasComments && comments.map((c) => (
          <div
            key={c.id}
            className="mt-1 rounded-md px-2 py-1 text-[11px]"
            style={{ background: 'rgba(245, 158, 11, 0.08)', color: '#f59e0b' }}
          >
            {c.comment_text}
            {c.suggested_fix && (
              <span style={{ color: '#22c55e' }}> &rarr; {c.suggested_fix}</span>
            )}
          </div>
        ))}
      </div>

      {/* Comment indicator */}
      <span
        className={`mt-1 text-[10px] transition-opacity ${hasComments ? 'opacity-60' : 'opacity-0 group-hover:opacity-60'}`}
        style={{ color: hasComments ? '#f59e0b' : 'var(--text-muted)' }}
      >
        {hasComments ? '\u270E' : '+'}
      </span>

      {showComment && (
        <FieldComment
          articleUrl={articleUrl}
          fieldPath={fieldPath}
          currentValue={displayValue}
          onClose={() => {
            setShowComment(false);
            onCommentSaved?.();
          }}
        />
      )}
    </div>
  );
}

function EnrichedArticleView({
  article,
  articleUrl,
  index,
  commentsByField,
  onCommentSaved,
}: {
  article: EnrichedArticle;
  articleUrl: string;
  index: number;
  commentsByField: Map<string, AdminComment[]>;
  onCommentSaved: () => void;
}) {
  const loc = article.location || {};
  const crime = article.crime || {};
  const details = article.details || {};
  const time = article.incident_time || {};

  // Helper to inject comments props into every FieldRow
  const fp = (fieldPath: string) => ({
    fieldPath,
    articleUrl,
    comments: commentsByField.get(fieldPath),
    onCommentSaved,
  });

  return (
    <div className="space-y-3">
      {index > 0 && (
        <div className="border-t pt-3" style={{ borderColor: 'var(--border-inner)' }}>
          <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--accent)' }}>
            Split Incident #{index + 1}
          </span>
        </div>
      )}

      {/* Classification badge */}
      {article.classification && (
        <ClassificationBadge
          classification={article.classification}
          reason={article.classification.toLowerCase() === 'junk' || article.classification.toLowerCase() === 'feuerwehr'
            ? (article as unknown as Record<string, unknown>).reason as string | undefined
            : undefined}
        />
      )}

      <FieldRow label="Clean Title" value={article.clean_title} {...fp('clean_title')} />
      <FieldRow label="Is Update" value={article.is_update ? 'Yes' : 'No'} {...fp('is_update')} />

      {/* Location */}
      <div className="mt-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
          Location
        </span>
      </div>
      <FieldRow label="Street" value={loc.street} {...fp('location.street')} confidence={loc.confidence} />
      <FieldRow label="House Nr" value={loc.house_number} {...fp('location.house_number')} confidence={loc.confidence} />
      <FieldRow label="District" value={loc.district} {...fp('location.district')} />
      <FieldRow label="City" value={loc.city} {...fp('location.city')} confidence={loc.confidence} />
      <FieldRow label="Hint" value={loc.location_hint} {...fp('location.location_hint')} />
      <FieldRow
        label="Lat/Lon"
        value={loc.lat && loc.lon ? `${loc.lat}, ${loc.lon}` : null}
        href={loc.lat && loc.lon ? `https://www.google.com/maps?q=${loc.lat},${loc.lon}` : undefined}
        {...fp('location.coords')}
      />
      <FieldRow label="Precision" value={loc.precision} {...fp('location.precision')} />

      {/* Incident Time */}
      <div className="mt-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
          Incident Time
        </span>
      </div>
      <FieldRow label="Start Date" value={time.start_date || time.date} {...fp('incident_time.start_date')} />
      <FieldRow label="Start Time" value={time.start_time || time.time} {...fp('incident_time.start_time')} />
      <FieldRow label="End Date" value={time.end_date} {...fp('incident_time.end_date')} />
      <FieldRow label="End Time" value={time.end_time} {...fp('incident_time.end_time')} />
      <FieldRow label="Precision" value={time.precision} {...fp('incident_time.precision')} />

      {/* Crime */}
      <div className="mt-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
          Crime (PKS)
        </span>
      </div>
      <FieldRow label="PKS Code" value={crime.pks_code} {...fp('crime.pks_code')} confidence={crime.confidence} />
      <FieldRow label="Category" value={crime.pks_category} {...fp('crime.pks_category')} />
      <FieldRow label="Sub-type" value={crime.sub_type} {...fp('crime.sub_type')} />

      {/* Details */}
      <div className="mt-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
          Details
        </span>
      </div>
      <FieldRow label="Weapon" value={details.weapon_type} {...fp('details.weapon_type')} />
      <FieldRow label="Drug" value={details.drug_type} {...fp('details.drug_type')} />
      <FieldRow label="Severity" value={details.severity} {...fp('details.severity')} />
      <FieldRow label="Motive" value={details.motive} {...fp('details.motive')} />
      <FieldRow label="Victims" value={details.victim_count} {...fp('details.victim_count')} />
      <FieldRow label="Suspects" value={details.suspect_count} {...fp('details.suspect_count')} />
      <FieldRow label="Victim Age" value={details.victim_age} {...fp('details.victim_age')} />
      <FieldRow label="Suspect Age" value={details.suspect_age} {...fp('details.suspect_age')} />
      <FieldRow label="Victim Gender" value={details.victim_gender} {...fp('details.victim_gender')} />
      <FieldRow label="Suspect Gender" value={details.suspect_gender} {...fp('details.suspect_gender')} />
      <FieldRow label="Victim Origin" value={details.victim_herkunft} {...fp('details.victim_herkunft')} />
      <FieldRow label="Suspect Origin" value={details.suspect_herkunft} {...fp('details.suspect_herkunft')} />
      <FieldRow label="Victim Desc." value={details.victim_description} {...fp('details.victim_description')} />
      <FieldRow label="Suspect Desc." value={details.suspect_description} {...fp('details.suspect_description')} />
      <FieldRow label="Damage (\u20AC)" value={details.damage_amount_eur != null ? `${details.damage_amount_eur.toLocaleString('de-DE')} \u20AC` : null} {...fp('details.damage_amount_eur')} />
      <FieldRow label="Damage Est." value={details.damage_estimate} {...fp('details.damage_estimate')} />
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function ReEnrichDropdown({
  onSelect,
  loading,
}: {
  onSelect: (promptVersion: string) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: promptsData } = usePrompts();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const versions = promptsData?.versions ?? [];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase transition-colors"
        style={{
          background: loading ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.12)',
          color: '#6366f1',
          opacity: loading ? 0.6 : 1,
          cursor: loading ? 'wait' : 'pointer',
        }}
      >
        {loading ? (
          <>
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Re-enriching...
          </>
        ) : (
          <>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.534 7h3.932a.25.25 0 01.192.41l-1.966 2.36a.25.25 0 01-.384 0l-1.966-2.36a.25.25 0 01.192-.41zm-5.764 0H1.804a.25.25 0 00-.192.41l1.966 2.36a.25.25 0 00.384 0l1.966-2.36a.25.25 0 00-.192-.41z" />
              <path fillRule="evenodd" d="M8 3a5 5 0 11-4.546 2.914.5.5 0 00-.908-.418A6 6 0 108 2v1z" />
            </svg>
            Re-enrich
            <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
              <path d="M4 6L1 3h6L4 6z" />
            </svg>
          </>
        )}
      </button>

      {open && !loading && (
        <div
          className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border py-1 shadow-lg"
          style={{
            background: 'var(--card)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          {versions.length === 0 ? (
            <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
              No prompt versions found
            </div>
          ) : (
            versions.map((v) => (
              <button
                key={v.name}
                onClick={() => {
                  onSelect(v.name);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--card-inner)]"
                style={{ color: 'var(--text-primary)' }}
              >
                <span className="font-mono font-semibold">{v.name}</span>
                {v.isActive && (
                  <span
                    className="rounded px-1 py-px text-[9px] font-bold uppercase"
                    style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}
                  >
                    active
                  </span>
                )}
                {v.config?.model && (
                  <span
                    className="ml-auto font-mono text-[9px] truncate max-w-[120px]"
                    style={{ color: 'var(--text-faint)' }}
                    title={v.config.model}
                  >
                    {v.config.model.split('/').pop()}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function ArticleEnrichedPanel({ articles, cacheEntry, articleUrl, rawArticle }: ArticleEnrichedPanelProps) {
  const [commentsByField, setCommentsByField] = useState<Map<string, AdminComment[]>>(new Map());
  const [activeVersion, setActiveVersion] = useState<'original' | string>('original');
  const [reEnrichLoading, setReEnrichLoading] = useState(false);
  const [reEnrichError, setReEnrichError] = useState<string | null>(null);

  const { data: versions, mutate: mutateVersions } = useEnrichmentVersions(articleUrl || null);

  // Reset to original when article changes
  useEffect(() => {
    setActiveVersion('original');
    setReEnrichError(null);
  }, [articleUrl]);

  const fetchComments = useCallback(async () => {
    if (!articleUrl) return;
    try {
      const res = await fetch(`/api/admin/comments?articleUrl=${encodeURIComponent(articleUrl)}`);
      if (!res.ok) return;
      const data: AdminComment[] = await res.json();
      const map = new Map<string, AdminComment[]>();
      for (const c of data) {
        const existing = map.get(c.field_path) || [];
        existing.push(c);
        map.set(c.field_path, existing);
      }
      setCommentsByField(map);
    } catch {
      // silently fail
    }
  }, [articleUrl]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const handleReEnrich = useCallback(async (promptVersion: string) => {
    if (!rawArticle || !articleUrl) return;
    setReEnrichLoading(true);
    setReEnrichError(null);
    try {
      const res = await fetch('/api/admin/re-enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleUrl,
          title: rawArticle.title,
          body: rawArticle.body,
          date: rawArticle.date,
          city: rawArticle.city,
          bundesland: rawArticle.bundesland,
          source: rawArticle.source,
          promptVersion,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Re-enrichment failed');
      }
      const newVersion: EnrichmentVersion = await res.json();
      await mutateVersions();
      setActiveVersion(newVersion.id);
    } catch (e) {
      setReEnrichError(String(e instanceof Error ? e.message : e));
    } finally {
      setReEnrichLoading(false);
    }
  }, [rawArticle, articleUrl, mutateVersions]);

  // Check if it was classified as junk/feuerwehr
  const cacheArr = Array.isArray(cacheEntry) ? cacheEntry : cacheEntry ? [cacheEntry] : [];
  const isJunk = cacheArr.length === 1 && (cacheArr[0] as Record<string, unknown>)?._classification;

  if (isJunk) {
    const entry = cacheArr[0] as Record<string, string>;
    return (
      <div className="h-full overflow-y-auto p-4 custom-scrollbar">
        <div className="mb-4 flex items-center gap-2">
          <span
            className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase"
            style={{
              background: entry._classification === 'junk' ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
              color: entry._classification === 'junk' ? '#ef4444' : '#f59e0b',
            }}
          >
            {entry._classification}
          </span>
          {rawArticle && (
            <ReEnrichDropdown onSelect={handleReEnrich} loading={reEnrichLoading} />
          )}
        </div>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Reason: {entry.reason || 'No reason provided'}
        </p>
        {reEnrichError && (
          <div className="mt-2 rounded-md px-2 py-1 text-[11px]" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
            {reEnrichError}
          </div>
        )}
        {/* Show re-enriched versions even for junk articles */}
        {versions && versions.length > 0 && (
          <ReEnrichVersionsSection
            versions={versions}
            activeVersion={activeVersion}
            onSelectVersion={setActiveVersion}
            articleUrl={articleUrl}
            commentsByField={commentsByField}
            fetchComments={fetchComments}
          />
        )}
      </div>
    );
  }

  if (!articles.length && !(versions && versions.length > 0)) {
    return (
      <div className="flex h-full items-center justify-center p-4" style={{ color: 'var(--text-faint)' }}>
        <div className="text-center">
          <p>No enrichment data &mdash; article may not have been processed yet.</p>
          {rawArticle && (
            <div className="mt-3">
              <ReEnrichDropdown onSelect={handleReEnrich} loading={reEnrichLoading} />
            </div>
          )}
        </div>
      </div>
    );
  }

  const totalComments = Array.from(commentsByField.values()).reduce((sum, arr) => sum + arr.length, 0);

  // Determine which articles to render
  const activeVersionData = activeVersion !== 'original' && versions
    ? versions.find(v => v.id === activeVersion)
    : null;

  const displayArticles: EnrichedArticle[] = activeVersionData
    ? activeVersionData.enriched_data
    : articles;

  const hasVersions = versions && versions.length > 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header bar */}
      <div className="shrink-0 p-4 pb-0">
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <span
            className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase"
            style={{
              background: 'rgba(34, 197, 94, 0.12)',
              color: '#22c55e',
            }}
          >
            Enriched Output
          </span>
          {articles.length > 1 && activeVersion === 'original' && (
            <span
              className="rounded-md px-2 py-0.5 text-[10px] font-bold"
              style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}
            >
              {articles.length} incidents split
            </span>
          )}
          {totalComments > 0 && activeVersion === 'original' && (
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
              style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2.5 2A1.5 1.5 0 001 3.5v8.793a.5.5 0 00.854.353l2.853-2.853A1 1 0 015.414 9.5H12.5A1.5 1.5 0 0014 8V3.5A1.5 1.5 0 0012.5 2h-10z" />
              </svg>
              {totalComments} comment{totalComments !== 1 ? 's' : ''}
            </span>
          )}

          <div className="ml-auto">
            {rawArticle && (
              <ReEnrichDropdown onSelect={handleReEnrich} loading={reEnrichLoading} />
            )}
          </div>
        </div>

        {reEnrichError && (
          <div className="mb-2 rounded-md px-2 py-1 text-[11px]" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
            {reEnrichError}
          </div>
        )}

        {/* Version tabs */}
        {hasVersions && (
          <div className="flex gap-1 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
            {(() => {
              const origClassification = getClassification(articles);
              return (
                <button
                  onClick={() => setActiveVersion('original')}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-bold uppercase transition-colors"
                  style={{
                    background: activeVersion === 'original' ? 'rgba(34,197,94,0.15)' : 'transparent',
                    color: activeVersion === 'original' ? '#22c55e' : 'var(--text-muted)',
                    border: `1px solid ${activeVersion === 'original' ? 'rgba(34,197,94,0.3)' : 'var(--border-subtle)'}`,
                  }}
                >
                  {origClassification && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: classificationDotColor(origClassification) }}
                    />
                  )}
                  Original
                </button>
              );
            })()}
            {versions!.map((v) => {
              const vClassification = getClassification(v.enriched_data);
              return (
                <button
                  key={v.id}
                  onClick={() => setActiveVersion(v.id)}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-bold transition-colors"
                  style={{
                    background: activeVersion === v.id ? 'rgba(99,102,241,0.15)' : 'transparent',
                    color: activeVersion === v.id ? '#6366f1' : 'var(--text-muted)',
                    border: `1px solid ${activeVersion === v.id ? 'rgba(99,102,241,0.3)' : 'var(--border-subtle)'}`,
                  }}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: classificationDotColor(vClassification) }}
                  />
                  <span className="font-mono">{v.prompt_version}</span>
                  <span className="opacity-60">{formatTime(v.created_at)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 custom-scrollbar relative">
        {/* Loading overlay */}
        {reEnrichLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg" style={{ background: 'rgba(0,0,0,0.4)' }}>
            <div className="flex flex-col items-center gap-2">
              <svg className="animate-spin h-6 w-6" style={{ color: '#6366f1' }} viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="text-[11px] font-bold uppercase" style={{ color: '#6366f1' }}>
                Running LLM...
              </span>
            </div>
          </div>
        )}

        {/* Metadata line + classification badge for re-enriched versions */}
        {activeVersionData && (
          <>
            <div
              className="mb-3 flex items-center gap-3 rounded-md px-2 py-1.5 text-[10px]"
              style={{ background: 'rgba(99,102,241,0.06)', color: 'var(--text-muted)' }}
            >
              <span>
                <span className="font-semibold" style={{ color: '#6366f1' }}>Model:</span>{' '}
                <span className="font-mono">{activeVersionData.model}</span>
              </span>
              {activeVersionData.total_tokens != null && (
                <span>
                  <span className="font-semibold" style={{ color: '#6366f1' }}>Tokens:</span>{' '}
                  {activeVersionData.prompt_tokens?.toLocaleString()}p + {activeVersionData.completion_tokens?.toLocaleString()}c = {activeVersionData.total_tokens.toLocaleString()}
                </span>
              )}
              {activeVersionData.latency_ms != null && (
                <span>
                  <span className="font-semibold" style={{ color: '#6366f1' }}>Latency:</span>{' '}
                  {(activeVersionData.latency_ms / 1000).toFixed(1)}s
                </span>
              )}
            </div>
            {/* Classification badge for the active re-enriched version */}
            {(() => {
              const cls = getClassification(activeVersionData.enriched_data);
              if (!cls) return null;
              const reason = cls.toLowerCase() === 'junk' || cls.toLowerCase() === 'feuerwehr'
                ? (activeVersionData.enriched_data[0] as unknown as Record<string, unknown>).reason as string | undefined
                : undefined;
              return <ClassificationBadge classification={cls} reason={reason} />;
            })()}
          </>
        )}

        {displayArticles.map((art, i) => (
          <EnrichedArticleView
            key={activeVersion === 'original' ? i : `${activeVersion}-${i}`}
            article={art}
            articleUrl={articleUrl}
            index={i}
            commentsByField={commentsByField}
            onCommentSaved={fetchComments}
          />
        ))}
      </div>
    </div>
  );
}

// Sub-component for showing re-enriched versions on junk articles
function ReEnrichVersionsSection({
  versions,
  activeVersion,
  onSelectVersion,
  articleUrl,
  commentsByField,
  fetchComments,
}: {
  versions: EnrichmentVersion[];
  activeVersion: string;
  onSelectVersion: (id: string) => void;
  articleUrl: string;
  commentsByField: Map<string, AdminComment[]>;
  fetchComments: () => void;
}) {
  const activeVersionData = versions.find(v => v.id === activeVersion);

  return (
    <div className="mt-4">
      <div className="flex gap-1 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
        {versions.map((v) => {
          const vClassification = getClassification(v.enriched_data);
          return (
            <button
              key={v.id}
              onClick={() => onSelectVersion(v.id)}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-bold transition-colors"
              style={{
                background: activeVersion === v.id ? 'rgba(99,102,241,0.15)' : 'transparent',
                color: activeVersion === v.id ? '#6366f1' : 'var(--text-muted)',
                border: `1px solid ${activeVersion === v.id ? 'rgba(99,102,241,0.3)' : 'var(--border-subtle)'}`,
              }}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: classificationDotColor(vClassification) }}
              />
              <span className="font-mono">{v.prompt_version}</span>
              <span className="opacity-60">{formatTime(v.created_at)}</span>
            </button>
          );
        })}
      </div>

      {activeVersionData && (
        <>
          <div
            className="mb-3 flex items-center gap-3 rounded-md px-2 py-1.5 text-[10px]"
            style={{ background: 'rgba(99,102,241,0.06)', color: 'var(--text-muted)' }}
          >
            <span>
              <span className="font-semibold" style={{ color: '#6366f1' }}>Model:</span>{' '}
              <span className="font-mono">{activeVersionData.model}</span>
            </span>
            {activeVersionData.total_tokens != null && (
              <span>
                <span className="font-semibold" style={{ color: '#6366f1' }}>Tokens:</span>{' '}
                {activeVersionData.prompt_tokens?.toLocaleString()}p + {activeVersionData.completion_tokens?.toLocaleString()}c = {activeVersionData.total_tokens.toLocaleString()}
              </span>
            )}
            {activeVersionData.latency_ms != null && (
              <span>
                <span className="font-semibold" style={{ color: '#6366f1' }}>Latency:</span>{' '}
                {(activeVersionData.latency_ms / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          {/* Classification badge for re-enriched version in junk panel */}
          {(() => {
            const cls = getClassification(activeVersionData.enriched_data);
            if (!cls) return null;
            const reason = cls.toLowerCase() === 'junk' || cls.toLowerCase() === 'feuerwehr'
              ? (activeVersionData.enriched_data[0] as unknown as Record<string, unknown>).reason as string | undefined
              : undefined;
            return <ClassificationBadge classification={cls} reason={reason} />;
          })()}
          {activeVersionData.enriched_data.map((art, i) => (
            <EnrichedArticleView
              key={`${activeVersion}-${i}`}
              article={art}
              articleUrl={articleUrl}
              index={i}
              commentsByField={commentsByField}
              onCommentSaved={fetchComments}
            />
          ))}
        </>
      )}
    </div>
  );
}
