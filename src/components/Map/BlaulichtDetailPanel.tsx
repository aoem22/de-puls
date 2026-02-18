'use client';

import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from 'react';
import type { CrimeRecord, CrimeCategory, Gender, Severity, Motive, DrugType, IncidentTimePrecision } from '@/lib/types/crime';
import { CRIME_CATEGORIES, WEAPON_LABELS, SEVERITY_LABELS, MOTIVE_LABELS, GENDER_LABELS, DRUG_LABELS } from '@/lib/types/crime';
import { WeaponIcon } from './BlaulichtPlaybackControl';
import { useTranslation, translations, tNested, type Language } from '@/lib/i18n';
import { fetchRelatedArticles } from '@/lib/supabase/queries';
import { useCrimeDetail } from '@/lib/supabase/hooks';
import { useDraggableSheet } from './useBottomSheet';

interface BlaulichtDetailPanelProps {
  crime: CrimeRecord;
  onClose: () => void;
  isPreview?: boolean;
  flashToken?: number;
  isFavorite?: boolean;
  onToggleFavorite?: (id: string) => void;
  favoriteComment?: string;
  onSetFavoriteComment?: (id: string, comment: string) => void;
}

const categoryMeta = new Map<CrimeCategory, { label: string; color: string }>(
  CRIME_CATEGORIES.map((cat) => [cat.key, { label: cat.label, color: cat.color }])
);

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getCategoryInfo(category: CrimeCategory) {
  return categoryMeta.get(category) ?? { label: category, color: '#6b7280' };
}

// Clean SVG icons
const Icons = {
  close: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  ),
  calendar: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  clock: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
  location: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M12 21c-4-4-8-7.5-8-11a8 8 0 1116 0c0 3.5-4 7-8 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  ),
  tag: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M12 2l9 9-9.5 9.5a2.12 2.12 0 01-3 0L2 14l9-9a2 2 0 011-1z" />
      <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" />
    </svg>
  ),
  agency: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 21h18M9 21V10l-3 2V8l6-4 6 4v4l-3-2v11" />
      <path d="M12 7v0" />
    </svg>
  ),
  externalLink: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
    </svg>
  ),
  alert: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16v.01" />
    </svg>
  ),
  chevron: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  starOutline: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  ),
  starFilled: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  ),
  pencil: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  ),
};

/**
 * Inline comment input for favorited records.
 * Auto-saves on blur and Enter.
 */
function CommentInput({
  crimeId,
  value,
  onChange,
  placeholder,
}: {
  crimeId: string;
  value: string;
  onChange: (id: string, comment: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external value changes (e.g. when switching records)
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const save = useCallback(() => {
    if (draft !== value) onChange(crimeId, draft);
  }, [draft, value, crimeId, onChange]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
        inputRef.current?.blur();
      }
    },
    [save]
  );

  return (
    <div className="flex items-center gap-2 mt-2">
      <span className="text-[var(--text-muted)] shrink-0">{Icons.pencil}</span>
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="flex-1 bg-[var(--card-inner)] border border-[var(--border-inner)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-secondary)] placeholder-[var(--text-faint)] outline-none focus:border-amber-500/40 transition-colors"
      />
    </div>
  );
}

/**
 * Build a person info line: count + age + gender + herkunft
 */
function personLine(
  count: number | null | undefined,
  age: string | null | undefined,
  gender: Gender | null | undefined,
  herkunft: string | null | undefined,
  lang: Language,
  t: typeof translations
): string | null {
  const parts: string[] = [];
  if (count != null && count > 0) parts.push(`${count}x`);
  if (age) parts.push(`${age} ${t.age[lang]}`);
  if (gender && gender !== 'unknown') parts.push(GENDER_LABELS[gender][lang]);
  if (herkunft) parts.push(herkunft);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Format a YYYY-MM-DD date string to DD.MM.YYYY
 */
function fmtDate(d: string): string {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d;
}

/**
 * Format incident date/time for display, supporting time spans.
 * - Single point: "10.02.2026, 14:30 (ca.)"
 * - Same-day span: "10.02.2026, 14:30 – 16:30 (ca.)"
 * - Multi-day span: "10.02.2026, 14:30 – 11.02.2026, 08:00 (ca.)"
 */
function formatIncidentDate(
  date: string | null | undefined,
  time: string | null | undefined,
  precision: IncidentTimePrecision | null | undefined,
  lang: Language,
  endDate?: string | null,
  endTime?: string | null,
): string | null {
  if (!date) return null;

  // Build start part
  let start = fmtDate(date);
  if (time) start += `, ${time}`;

  // Build end part if present
  const hasEnd = endDate || endTime;
  let result = start;
  if (hasEnd) {
    const sameDay = endDate === date || !endDate;
    if (sameDay && endTime) {
      // Same day — only show end time
      result += ` – ${endTime}`;
    } else if (endDate) {
      let end = fmtDate(endDate);
      if (endTime) end += `, ${endTime}`;
      result += ` – ${end}`;
    }
  }

  if (precision && precision !== 'unknown') {
    const precLabel = tNested('timePrecisionLabels', precision, lang);
    result += ` (${precLabel})`;
  }
  return result;
}

/**
 * Get the display title — prefer cleanTitle, fallback to title
 */
function getDisplayTitle(crime: CrimeRecord): string {
  return crime.cleanTitle?.trim() || crime.title;
}

/**
 * Group role badge color/label
 */
const ROLE_BADGES: Record<string, { label: { de: string; en: string }; color: string }> = {
  primary: { label: { de: 'Erstmeldung', en: 'Initial' }, color: '#3b82f6' },
  follow_up: { label: { de: 'Folgemeldung', en: 'Follow-up' }, color: '#f59e0b' },
  update: { label: { de: 'Update', en: 'Update' }, color: '#8b5cf6' },
  resolution: { label: { de: 'Abschluss', en: 'Resolution' }, color: '#22c55e' },
  related: { label: { de: 'Verwandt', en: 'Related' }, color: '#6b7280' },
};

/**
 * Details section — shown between metadata and body text
 */
function DetailsSection({ crime, lang, compact = false }: { crime: CrimeRecord; lang: Language; compact?: boolean }) {
  const t = translations;

  const victimLine = personLine(crime.victimCount, crime.victimAge, crime.victimGender, crime.victimHerkunft, lang, t);
  const suspectLine = personLine(crime.suspectCount, crime.suspectAge, crime.suspectGender, crime.suspectHerkunft, lang, t);
  const severity = crime.severity && crime.severity !== 'unknown' ? crime.severity as Severity : null;
  const drugType = crime.drugType as DrugType | null;
  const motive = crime.motive && crime.motive !== 'unknown' ? crime.motive as Motive : null;

  const hasContent = victimLine || suspectLine || crime.victimDescription || crime.suspectDescription || severity || drugType || motive;
  if (!hasContent) return null;

  const px = compact ? 'px-4' : 'px-5';
  const py = compact ? 'py-3' : 'py-4';

  return (
    <div className={`${px} ${py} space-y-2.5 border-b border-[var(--card-border)]`}>
      <div className="flex items-center gap-3 mb-1">
        <span className="text-[10px] font-semibold tracking-widest text-[var(--text-muted)] uppercase">
          {t.details[lang]}
        </span>
        <div className="flex-1 h-px bg-[var(--card-elevated)]" />
      </div>

      {(victimLine || crime.victimDescription) && (
        <div className="flex items-start gap-3">
          <span className="text-[var(--text-muted)] w-5 flex justify-center text-xs mt-0.5">👤</span>
          <div className="text-sm text-[var(--text-secondary)]">
            {victimLine && (
              <div>
                <span className="text-[var(--text-muted)] mr-1.5">{t.victim[lang]}:</span>
                {victimLine}
              </div>
            )}
            {crime.victimDescription && (
              <div className="text-xs text-[var(--text-tertiary)] mt-0.5 italic">{crime.victimDescription}</div>
            )}
          </div>
        </div>
      )}

      {(suspectLine || crime.suspectDescription) && (
        <div className="flex items-start gap-3">
          <span className="text-[var(--text-muted)] w-5 flex justify-center text-xs mt-0.5">👤</span>
          <div className="text-sm text-[var(--text-secondary)]">
            {suspectLine && (
              <div>
                <span className="text-[var(--text-muted)] mr-1.5">{t.suspect[lang]}:</span>
                {suspectLine}
              </div>
            )}
            {crime.suspectDescription && (
              <div className="text-xs text-[var(--text-tertiary)] mt-0.5 italic">{crime.suspectDescription}</div>
            )}
          </div>
        </div>
      )}

      {severity && (
        <div className="flex items-center gap-3">
          <span className="text-[var(--text-muted)] w-5 flex justify-center text-xs">⚠️</span>
          <span
            className="px-2.5 py-0.5 text-xs rounded-md border font-medium"
            style={{
              backgroundColor: `${SEVERITY_LABELS[severity].color}15`,
              borderColor: `${SEVERITY_LABELS[severity].color}35`,
              color: SEVERITY_LABELS[severity].color,
            }}
          >
            {SEVERITY_LABELS[severity][lang]}
          </span>
        </div>
      )}

      {drugType && (
        <div className="flex items-center gap-3">
          <span className="text-[var(--text-muted)] w-5 flex justify-center text-xs">💊</span>
          <span className="text-sm text-[var(--text-secondary)]">
            {DRUG_LABELS[drugType][lang]}
          </span>
        </div>
      )}

      {motive && (
        <div className="flex items-center gap-3">
          <span className="text-[var(--text-muted)] w-5 flex justify-center text-xs">📋</span>
          <span className="text-sm text-[var(--text-secondary)]">
            <span className="text-[var(--text-muted)] mr-1.5">{t.motiveLabel[lang]}:</span>
            {MOTIVE_LABELS[motive][lang]}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Timeline section — shows related Pressemeldungen for grouped incidents
 */
function TimelineSection({ crime, lang }: { crime: CrimeRecord; lang: Language }) {
  const t = translations;
  const [related, setRelated] = useState<CrimeRecord[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!crime.incidentGroupId) return;
    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setExpandedId(null);
      }
    });
    fetchRelatedArticles(crime.incidentGroupId)
      .then((articles) => {
        if (cancelled) return;
        // Filter out the current article and sort chronologically
        const others = articles.filter((a) => a.id !== crime.id);
        setRelated(others);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [crime.incidentGroupId, crime.id]);

  if (!crime.incidentGroupId || (related.length === 0 && !loading)) return null;

  return (
    <div className="px-5 py-4 border-b border-[var(--card-border)]">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[10px] font-semibold tracking-widest text-[var(--text-muted)] uppercase">
          {t.timeline[lang]} ({related.length + 1} {t.messages[lang]})
        </span>
        <div className="flex-1 h-px bg-[var(--card-elevated)]" />
      </div>

      {loading ? (
        <div className="text-xs text-[var(--text-muted)] py-2">...</div>
      ) : (
        <div className="space-y-1.5">
          {/* Current article marker */}
          <div className="flex items-start gap-2.5">
            <div className="mt-1.5 w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
            <div className="min-w-0">
              <span className="text-xs text-[var(--text-tertiary)]">
                {crime.incidentDate
                  ? formatIncidentDate(crime.incidentDate, null, null, lang)
                  : formatDate(crime.publishedAt).split(',')[0]}
              </span>
              <span className="text-xs text-[var(--text-secondary)] ml-2">{getDisplayTitle(crime)}</span>
              {crime.groupRole && ROLE_BADGES[crime.groupRole] && (
                <span
                  className="ml-2 px-1.5 py-0.5 text-[10px] rounded border font-medium"
                  style={{
                    backgroundColor: `${ROLE_BADGES[crime.groupRole].color}15`,
                    borderColor: `${ROLE_BADGES[crime.groupRole].color}35`,
                    color: ROLE_BADGES[crime.groupRole].color,
                  }}
                >
                  {ROLE_BADGES[crime.groupRole].label[lang]}
                </span>
              )}
            </div>
          </div>

          {/* Related articles as expandable items */}
          {related.map((art) => {
            const isExpanded = expandedId === art.id;
            const badge = art.groupRole ? ROLE_BADGES[art.groupRole] : null;

            return (
              <div key={art.id}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : art.id)}
                  className="flex items-start gap-2.5 w-full text-left hover:bg-[var(--card-inner)] rounded-md px-1 py-0.5 -mx-1 transition-colors"
                >
                  <div className="mt-1.5 w-2.5 h-2.5 rounded-full border border-[var(--text-faint)] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="text-xs text-[var(--text-tertiary)]">
                      {art.incidentDate
                        ? formatIncidentDate(art.incidentDate, null, null, lang)
                        : formatDate(art.publishedAt).split(',')[0]}
                    </span>
                    <span className="text-xs text-[var(--text-secondary)] ml-2 line-clamp-1">
                      {getDisplayTitle(art)}
                    </span>
                    {badge && (
                      <span
                        className="ml-2 px-1.5 py-0.5 text-[10px] rounded border font-medium"
                        style={{
                          backgroundColor: `${badge.color}15`,
                          borderColor: `${badge.color}35`,
                          color: badge.color,
                        }}
                      >
                        {badge.label[lang]}
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-[var(--text-muted)] shrink-0 mt-0.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  >
                    {Icons.chevron}
                  </span>
                </button>

                {isExpanded && art.body && (
                  <div className="ml-5 mt-1 mb-2 pl-3 border-l border-[var(--card-border)]">
                    <p className="text-xs text-[var(--text-tertiary)] leading-relaxed whitespace-pre-wrap line-clamp-6">
                      {art.body}
                    </p>
                    {art.sourceUrl && (
                      <a
                        href={art.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] mt-1 inline-flex items-center gap-1"
                      >
                        {Icons.externalLink}
                        <span>Quelle</span>
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Metadata section — shared between desktop and mobile
 */
function MetadataSection({
  crime,
  lang,
  compact = false,
}: {
  crime: CrimeRecord;
  lang: Language;
  compact?: boolean;
}) {
  const t = translations;
  const px = compact ? 'px-4' : 'px-5';
  const py = compact ? 'py-3' : 'py-4';

  const getCategoryLabel = (cat: CrimeCategory) => {
    const translated = tNested('crimeCategories', cat, lang);
    return translated !== cat ? translated : categoryMeta.get(cat)?.label ?? cat;
  };

  // Tatzeit (incident date/time) — promoted to metadata
  const incidentTimeStr = formatIncidentDate(
    crime.incidentDate,
    crime.incidentTime,
    crime.incidentTimePrecision,
    lang,
    crime.incidentEndDate,
    crime.incidentEndTime,
  );

  // Precise Delikt-Ort (crime location — street + house number)
  const crimeLocation = (() => {
    const loc = crime.locationText;
    if (loc) return loc;
    return null;
  })();

  return (
    <div className={`${px} ${py} space-y-3 border-b border-[var(--card-border)] bg-[var(--background)]`}>
      {/* Tatzeit (incident time) — primary date */}
      {incidentTimeStr ? (
        <div className="flex items-center gap-3">
          <span className="text-[var(--text-tertiary)] w-5 flex justify-center">{Icons.clock}</span>
          <span className="text-sm text-[var(--text-secondary)]">
            <span className="text-[var(--text-muted)] mr-1.5">{t.crimeTime[lang]}:</span>
            {incidentTimeStr}
          </span>
        </div>
      ) : (
        /* Fallback to published_at if no incident time */
        <div className="flex items-center gap-3">
          <span className="text-[var(--text-tertiary)] w-5 flex justify-center">{Icons.calendar}</span>
          <span className="text-sm text-[var(--text-secondary)]">{formatDate(crime.publishedAt)}</span>
        </div>
      )}

      {/* Delikt-Ort (crime location) */}
      {crimeLocation && (
        <div className="flex items-center gap-3">
          <span className="text-[var(--text-tertiary)] w-5 flex justify-center">{Icons.location}</span>
          <span className="text-sm text-[var(--text-secondary)]">{crimeLocation}</span>
        </div>
      )}

      {/* Agency */}
      {crime.sourceAgency && (
        <div className="flex items-center gap-3">
          <span className="text-[var(--text-tertiary)] w-5 flex justify-center">{Icons.agency}</span>
          <span className="text-sm text-[var(--text-secondary)]">{crime.sourceAgency}</span>
        </div>
      )}

      {/* Category badges */}
      <div className="flex items-start gap-3">
        <span className="text-[var(--text-tertiary)] w-5 flex justify-center mt-0.5">{Icons.tag}</span>
        <div className="flex flex-wrap gap-1.5">
          {crime.categories.length > 0 ? (
            crime.categories.map((cat) => {
              const info = getCategoryInfo(cat);
              return (
                <span
                  key={cat}
                  className={`${compact ? 'px-2 py-0.5' : 'px-2.5 py-1'} text-xs rounded-md border font-medium`}
                  style={{
                    backgroundColor: `${info.color}10`,
                    borderColor: `${info.color}30`,
                    color: info.color,
                  }}
                >
                  {getCategoryLabel(cat)}
                </span>
              );
            })
          ) : (
            <span className={`${compact ? 'px-2 py-0.5' : 'px-2.5 py-1'} text-xs rounded-md bg-[var(--card)] border border-[var(--card-border)] text-[var(--text-tertiary)]`}>
              {t.other[lang]}
            </span>
          )}
        </div>
      </div>

      {/* Weapon type */}
      {crime.weaponType && crime.weaponType !== 'none' && crime.weaponType !== 'unknown' && WEAPON_LABELS[crime.weaponType] && (
        <div className="flex items-center gap-3">
          <span className="w-5 flex justify-center"><WeaponIcon type={crime.weaponType} className="text-base" /></span>
          <span className={`${compact ? 'px-2 py-0.5' : 'px-2.5 py-1'} text-xs rounded-md border font-medium bg-red-950/30 border-red-900/40 text-red-400`}>
            {WEAPON_LABELS[crime.weaponType][lang]}
          </span>
        </div>
      )}
    </div>
  );
}

export function BlaulichtDetailPanel({ crime: slimCrime, onClose, isPreview = false, flashToken = 0, isFavorite = false, onToggleFavorite, favoriteComment = '', onSetFavoriteComment }: BlaulichtDetailPanelProps) {
  const { sheetRef, scrollRef, isExpanded, handlers } = useDraggableSheet(onClose);
  const { lang } = useTranslation();
  const t = translations;
  const flashClass = flashToken > 0
    ? (flashToken % 2 === 0 ? 'blaulicht-panel-flash-a' : 'blaulicht-panel-flash-b')
    : '';

  // Lazy-load full record (body, details, metadata) — only when not previewing
  const { data: fullCrime, isLoading: isLoadingDetail } = useCrimeDetail(isPreview ? null : slimCrime.id);
  const crime = fullCrime ?? slimCrime;

  const sourceDomain = (() => {
    try {
      return new URL(crime.sourceUrl).hostname.replace('www.', '');
    } catch {
      return 'presseportal.de';
    }
  })();

  const bodyText = crime.body;
  const displayTitle = getDisplayTitle(crime);

  return (
    <>
      {/* Backdrop - desktop only (mobile bottom sheet uses drag-to-dismiss) */}
      {!isPreview && (
        <div
          className="hidden md:block fixed inset-0 z-[1001] bg-black/30"
          onClick={onClose}
        />
      )}

      {/* Desktop: Right-side panel */}
      <div className={`hidden md:block fixed top-4 right-4 z-[1002] w-[380px] max-w-[calc(100vw-2rem)] pointer-events-none ${isPreview ? 'bottom-auto max-h-[70vh]' : 'bottom-4'}`}>
        <div className={`bg-[var(--background)] rounded-xl border shadow-2xl shadow-black/60 flex flex-col overflow-hidden pointer-events-auto animate-in slide-in-from-right-4 duration-200 ${isPreview ? 'border-[#252525]' : 'border-[var(--card-border)] h-full'} ${flashClass}`}>

          {/* Header */}
          <div className="px-5 py-4 border-b border-[var(--card-border)] flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="text-[var(--text-tertiary)]">{Icons.alert}</span>
              <span className="text-[11px] font-medium tracking-wide text-[var(--text-secondary)] uppercase">
                {t.pressRelease[lang]}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {onToggleFavorite && (
                <button
                  onClick={() => onToggleFavorite(crime.id)}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                    isFavorite
                      ? 'text-amber-400 hover:text-amber-300'
                      : 'text-[var(--text-muted)] hover:text-amber-400 hover:bg-[var(--card-elevated)]'
                  }`}
                  aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                >
                  {isFavorite ? Icons.starFilled : Icons.starOutline}
                </button>
              )}
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-elevated)] transition-colors"
                aria-label={t.close[lang]}
              >
                {Icons.close}
              </button>
            </div>
          </div>

          {/* Content area - scrollable */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {/* Title section */}
            <div className="px-5 py-5 border-b border-[var(--card-border)]">
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)] leading-relaxed">
                {displayTitle}
              </h2>
              {isFavorite && onSetFavoriteComment && (
                <CommentInput
                  crimeId={crime.id}
                  value={favoriteComment}
                  onChange={onSetFavoriteComment}
                  placeholder={t.notePlaceholder[lang]}
                />
              )}
            </div>

            {/* Metadata section */}
            <MetadataSection crime={crime} lang={lang} />

            {/* Details section (desktop) */}
            <DetailsSection crime={crime} lang={lang} />

            {/* Timeline section (for grouped articles) */}
            {!isPreview && <TimelineSection crime={crime} lang={lang} />}

            {/* Body text section */}
            {bodyText ? (
              <div className="px-5 py-5">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xs font-semibold tracking-widest text-[var(--text-tertiary)] uppercase">
                    {t.report[lang]}
                  </span>
                  <div className="flex-1 h-px bg-[var(--card-elevated)]" />
                </div>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                  {bodyText}
                </p>
              </div>
            ) : isLoadingDetail ? (
              <div className="px-5 py-5 space-y-2.5 animate-pulse">
                <div className="h-3 bg-[var(--card-elevated)] rounded w-3/4" />
                <div className="h-3 bg-[var(--card-elevated)] rounded w-full" />
                <div className="h-3 bg-[var(--card-elevated)] rounded w-5/6" />
              </div>
            ) : null}
          </div>

          {/* Footer - Source link */}
          <div className="px-5 py-4 border-t border-[var(--card-border)] bg-[var(--background)] flex-shrink-0">
            <a
              href={crime.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors group"
            >
              <span className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform">
                {Icons.externalLink}
              </span>
              <span>{t.openSource[lang]}</span>
              <span className="text-[var(--text-tertiary)] text-xs ml-auto">{sourceDomain}</span>
            </a>
          </div>
        </div>
      </div>

      {/* Mobile: Bottom sheet */}
      <div
        ref={sheetRef}
        className={`md:hidden fixed inset-x-0 bottom-0 z-[1002] mobile-bottom-sheet flex flex-col bg-[var(--background)] border-t border-[var(--card-border)] shadow-2xl shadow-black/60 overflow-hidden h-[100dvh] rounded-t-2xl animate-sheet-enter will-change-transform ${flashClass}`}
        {...handlers}
      >
        {/* Drag handle — tall touch target */}
        <div className="sheet-drag-area flex justify-center pt-3 pb-2 shrink-0 cursor-grab active:cursor-grabbing touch-action-none">
          <div className="drag-handle w-12 h-1.5 bg-[var(--text-muted)] rounded-full" />
        </div>

        {/* Header */}
        <div className="sheet-drag-area px-4 pb-3 border-b border-[var(--card-border)] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-tertiary)]">{Icons.alert}</span>
            <span className="text-[11px] font-medium tracking-wide text-[var(--text-secondary)] uppercase no-select">
              {t.report[lang]}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            {onToggleFavorite && (
              <button
                onClick={() => onToggleFavorite(crime.id)}
                className={`w-10 h-10 flex items-center justify-center rounded-lg touch-feedback transition-colors ${
                  isFavorite
                    ? 'text-amber-400'
                    : 'text-[var(--text-muted)] active:text-amber-400 active:bg-[var(--card-elevated)]'
                }`}
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                {isFavorite ? Icons.starFilled : Icons.starOutline}
              </button>
            )}
            <button
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-lg text-[var(--text-tertiary)] touch-feedback active:bg-[var(--card-elevated)]"
              aria-label={t.close[lang]}
            >
              {Icons.close}
            </button>
          </div>
        </div>

        {/* Content area - scrollable */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-touch overscroll-y-none">
          {/* Title section */}
          <div className="px-4 py-4 border-b border-[var(--card-border)]">
            <h2 className="text-base font-semibold text-[var(--text-primary)] leading-relaxed">
              {displayTitle}
            </h2>
            {isFavorite && onSetFavoriteComment && (
              <CommentInput
                crimeId={crime.id}
                value={favoriteComment}
                onChange={onSetFavoriteComment}
                placeholder={t.notePlaceholder[lang]}
              />
            )}
          </div>

          {/* Metadata section */}
          <MetadataSection crime={crime} lang={lang} compact={!isExpanded} />

          {/* Details section (mobile) */}
          <DetailsSection crime={crime} lang={lang} compact={!isExpanded} />

          {/* Timeline section (for grouped articles) */}
          <TimelineSection crime={crime} lang={lang} />

          {/* Body text section */}
          {bodyText ? (
            <div className={isExpanded ? 'px-5 py-5' : 'px-4 py-4'}>
              {isExpanded && (
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xs font-semibold tracking-widest text-[var(--text-tertiary)] uppercase">
                    {t.report[lang]}
                  </span>
                  <div className="flex-1 h-px bg-[var(--card-elevated)]" />
                </div>
              )}
              <p className={`text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap ${isExpanded ? '' : 'line-clamp-6'}`}>
                {bodyText}
              </p>
            </div>
          ) : isLoadingDetail ? (
            <div className="px-4 py-4 space-y-2 animate-pulse">
              <div className="h-3 bg-[var(--card-elevated)] rounded w-3/4" />
              <div className="h-3 bg-[var(--card-elevated)] rounded w-full" />
              <div className="h-3 bg-[var(--card-elevated)] rounded w-5/6" />
            </div>
          ) : null}
        </div>

        {/* Footer - Source link */}
        <div className="px-4 py-3 border-t border-[var(--card-border)] bg-[var(--background)] flex-shrink-0 safe-area-pb">
          <a
            href={crime.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 text-sm text-[var(--text-primary)] bg-[var(--card-elevated)] rounded-lg touch-feedback active:bg-[#252525] transition-colors"
          >
            {Icons.externalLink}
            <span className="no-select">{t.openSource[lang]}</span>
          </a>
        </div>
      </div>
    </>
  );
}
