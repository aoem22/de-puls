'use client';

import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { DashboardLiveFeedItem } from '@/lib/dashboard/types';

const SEVERITY_LABELS: Record<string, string> = {
  fatal: 'Tödlich',
  critical: 'Kritisch',
  serious: 'Schwer',
  minor: 'Leicht',
  property_only: 'Sachschaden',
  unknown: 'Unbekannt',
};

const WEAPON_LABELS: Record<string, string> = {
  knife: 'Messer',
  gun: 'Schusswaffe',
  blunt: 'Schlagwaffe',
  explosive: 'Sprengstoff',
  pepper_spray: 'Pfefferspray',
};

const MOTIVE_LABELS: Record<string, string> = {
  robbery: 'Raub',
  dispute: 'Streit',
  road_rage: 'Verkehrskonflikt',
  drugs: 'Drogen',
  domestic: 'Häuslich',
  hate: 'Hass',
};

const DRUG_LABELS: Record<string, string> = {
  cannabis: 'Cannabis',
  cocaine: 'Kokain',
  heroin: 'Heroin',
  amphetamine: 'Amphetamin',
  ecstasy: 'Ecstasy',
  methamphetamine: 'Crystal Meth',
};

const GENDER_LABELS: Record<string, string> = {
  male: 'Männlich',
  female: 'Weiblich',
};

function severityTone(severity: string | null): string {
  if (severity === 'fatal') return '#991b1b';
  if (severity === 'critical') return '#dc2626';
  if (severity === 'serious') return '#f97316';
  return 'var(--text-faint)';
}

function severityBg(severity: string | null): string {
  if (severity === 'fatal') return 'rgba(153,27,27,0.15)';
  if (severity === 'critical') return 'rgba(220,38,38,0.12)';
  if (severity === 'serious') return 'rgba(249,115,22,0.12)';
  return 'rgba(128,128,128,0.08)';
}

function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - Date.parse(isoDate);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Gerade eben veröffentlicht';
  if (minutes < 60) return `Vor ${minutes} Min veröffentlicht`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Vor ${hours} Std veröffentlicht`;
  const days = Math.floor(hours / 24);
  return `Vor ${days} Tag${days === 1 ? '' : 'en'} veröffentlicht`;
}

function formatDate(isoDate: string | null): string {
  if (!isoDate) return '';
  try {
    const date = new Date(isoDate.includes('T') ? isoDate : `${isoDate}T00:00:00`);
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return isoDate;
  }
}

function formatEur(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)} Mio. €`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}k €`;
  return `${amount.toLocaleString('de-DE')} €`;
}

function hasKnownWeaponType(weaponType: string | null): weaponType is string {
  return weaponType != null && weaponType !== 'unknown' && weaponType !== 'none';
}

function getKnownWeaponTypes(types: string[] | undefined | null): string[] {
  if (!types || !Array.isArray(types)) return [];
  return types.filter((w) => w !== 'unknown' && w !== 'none');
}

function LoadingCard() {
  return (
    <div
      className="h-28 animate-pulse rounded-2xl border"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--loading-skeleton)' }}
    />
  );
}

interface DetailTagProps {
  label: string;
  value: string;
  tone?: string;
}

function DetailTag({ label, value, tone }: DetailTagProps) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]"
      style={{
        borderColor: 'var(--border-inner)',
        background: 'var(--card)',
        color: tone ?? 'var(--text-secondary)',
      }}
    >
      <span style={{ color: 'var(--text-faint)' }}>{label}</span>
      {value}
    </span>
  );
}

interface DashboardLiveFeedSectionProps {
  showLoading: boolean;
  periodLabel: string;
  feedPage: number;
  onFeedPageChange: Dispatch<SetStateAction<number>>;
  liveFeed: DashboardLiveFeedItem[];
  liveFeedTotal: number;
  liveFeedPageSize: number;
  locationFilterLabel: string | null;
  onClearLocationFilter: () => void;
}

export function DashboardLiveFeedSection({
  showLoading,
  periodLabel,
  feedPage,
  onFeedPageChange,
  liveFeed,
  liveFeedTotal,
  liveFeedPageSize,
  locationFilterLabel,
  onClearLocationFilter,
}: DashboardLiveFeedSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const visibleExpandedId = liveFeed.some((row) => row.id === expandedId) ? expandedId : null;

  return (
    <section
      className="dashboard-rise dashboard-delay-3 rounded-2xl border p-4 sm:p-5"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'linear-gradient(145deg, var(--card) 0%, var(--card-elevated) 100%)',
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
            Pressemeldungen ({periodLabel})
          </h2>
          {locationFilterLabel && (
            <button
              type="button"
              onClick={onClearLocationFilter}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors hover:opacity-80"
              style={{
                background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
                color: 'var(--accent)',
              }}
            >
              {locationFilterLabel}
              <span className="ml-0.5 text-[9px]">✕</span>
            </button>
          )}
        </div>
        {!showLoading && liveFeed.length > 0 && (
          <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {((feedPage - 1) * liveFeedPageSize + 1).toLocaleString('de-DE')}–{((feedPage - 1) * liveFeedPageSize + liveFeed.length).toLocaleString('de-DE')} von {liveFeedTotal.toLocaleString('de-DE')}
          </span>
        )}
      </div>
      <div className="mt-3 space-y-2">
        {(!showLoading ? liveFeed : []).map((row) => {
          const isExpanded = visibleExpandedId === row.id;
          const knownWeapons = getKnownWeaponTypes(row.weapon_types);
          const hasWeaponTag = knownWeapons.length > 0;
          const isColdCase = row.is_cold_case === true;
          const hasTags = hasWeaponTag || row.motive || row.drug_type
            || row.victim_count || row.suspect_count || row.damage_amount_eur
            || row.victim_gender || row.suspect_gender || row.pks_category;

          return (
            <div
              key={row.id}
              className="rounded-xl border transition-colors"
              style={{
                borderColor: isExpanded ? 'var(--accent)' : 'var(--border-inner)',
                background: 'var(--card)',
              }}
            >
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : row.id)}
                className="w-full px-3 py-3 text-left"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                    style={{
                      background: severityBg(row.severity),
                      color: severityTone(row.severity),
                    }}
                  >
                    {SEVERITY_LABELS[row.severity ?? ''] ?? row.severity ?? 'Vorfall'}
                  </span>
                  {isColdCase && (
                    <span
                      className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                      style={{
                        background: 'rgba(251,191,36,0.15)',
                        color: '#b45309',
                      }}
                    >
                      Nachtrag
                    </span>
                  )}
                  <span className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                    {[row.city, row.bundesland].filter(Boolean).join(', ')}
                  </span>
                  <span className="ml-auto shrink-0 text-xs tabular-nums" style={{ color: 'var(--text-faint)' }}>
                    {formatDate(row.sort_date ?? row.incident_date ?? row.published_at)}
                    {row.incident_date && row.incident_time ? ` ${row.incident_time}` : ''}
                  </span>
                </div>

                <p className="mt-1.5 text-sm font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>
                  {row.clean_title || row.title}
                </p>

                {hasTags && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.pks_category && (
                      <DetailTag label="Delikt" value={row.pks_category} />
                    )}
                    {knownWeapons.map((wt) => (
                      <DetailTag
                        key={wt}
                        label="Waffe"
                        value={WEAPON_LABELS[wt] ?? wt}
                        tone={wt === 'knife' || wt === 'gun' ? '#ef4444' : undefined}
                      />
                    ))}
                    {row.motive && (
                      <DetailTag label="Motiv" value={MOTIVE_LABELS[row.motive] ?? row.motive} />
                    )}
                    {row.drug_type && (
                      <DetailTag label="Droge" value={DRUG_LABELS[row.drug_type] ?? row.drug_type} />
                    )}
                    {row.victim_count != null && (
                      <DetailTag label="Opfer" value={String(row.victim_count)} />
                    )}
                    {row.suspect_count != null && (
                      <DetailTag label="Verdächtige" value={String(row.suspect_count)} />
                    )}
                    {row.victim_gender && (
                      <DetailTag label="Opfer" value={`${GENDER_LABELS[row.victim_gender] ?? row.victim_gender}${row.victim_age ? `, ${row.victim_age} J.` : ''}`} />
                    )}
                    {row.suspect_gender && (
                      <DetailTag label="Täter" value={`${GENDER_LABELS[row.suspect_gender] ?? row.suspect_gender}${row.suspect_age ? `, ${row.suspect_age} J.` : ''}`} />
                    )}
                    {row.suspect_herkunft && (
                      <DetailTag label="Herkunft" value={row.suspect_herkunft} />
                    )}
                    {row.damage_amount_eur != null && (
                      <DetailTag label="Schaden" value={formatEur(row.damage_amount_eur)} />
                    )}
                  </div>
                )}

                <div className="mt-1.5 flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  {row.location_text && <span>{row.location_text}</span>}
                  <span className="ml-auto">{formatRelativeTime(row.published_at)}</span>
                </div>
              </button>

              {isExpanded && row.body && (
                <div
                  className="border-t px-3 py-3"
                  style={{ borderColor: 'var(--border-inner)' }}
                >
                  <p
                    className="whitespace-pre-line text-xs leading-relaxed"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {row.body}
                  </p>
                  {row.source_url && (
                    <a
                      href={row.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-[11px] font-semibold underline decoration-dotted underline-offset-2"
                      style={{ color: 'var(--accent)' }}
                    >
                      Originalquelle
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!showLoading && liveFeed.length === 0 && (
          <p className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border-inner)', color: 'var(--text-faint)' }}>
            Keine Vorfälle im gewählten Zeitraum.
          </p>
        )}
        {showLoading && (
          <>
            <LoadingCard />
            <LoadingCard />
          </>
        )}
      </div>

      {!showLoading && liveFeedTotal > liveFeedPageSize && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => onFeedPageChange((page) => Math.max(1, page - 1))}
            disabled={feedPage <= 1}
            className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-30"
            style={{
              borderColor: 'var(--border-subtle)',
              background: 'var(--card)',
              color: 'var(--text-secondary)',
            }}
          >
            ← Zurück
          </button>
          <span className="px-2 text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
            Seite {feedPage} / {Math.ceil(liveFeedTotal / liveFeedPageSize)}
          </span>
          <button
            onClick={() => onFeedPageChange((page) => Math.min(Math.ceil(liveFeedTotal / liveFeedPageSize), page + 1))}
            disabled={feedPage >= Math.ceil(liveFeedTotal / liveFeedPageSize)}
            className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-30"
            style={{
              borderColor: 'var(--border-subtle)',
              background: 'var(--card)',
              color: 'var(--text-secondary)',
            }}
          >
            Weiter →
          </button>
        </div>
      )}
    </section>
  );
}
