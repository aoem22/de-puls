'use client';

import { DASHBOARD_YEAR } from '@/lib/dashboard/timeframes';
import type { SecurityOverviewResponse, DashboardContextValue } from '@/lib/dashboard/types';
import { CRIME_CATEGORIES, type CrimeCategory } from '@/lib/types/crime';

type ContextCardType = 'suspectProfile' | 'victimProfile' | 'modusOperandi' | 'sceneTime' | 'damageReport' | 'herkunft';

const CONTEXT_CARD_LABELS: Record<ContextCardType, string> = {
  suspectProfile: 'Täterprofil',
  victimProfile: 'Opferprofil',
  modusOperandi: 'Tatmuster',
  sceneTime: 'Tatort & Zeit',
  damageReport: 'Schadensbilanz',
  herkunft: 'Herkunft',
};

const CATEGORY_CARD_MAP: Record<string, [ContextCardType, ContextCardType, ContextCardType]> = {
  sexual: ['herkunft', 'suspectProfile', 'victimProfile'],
  weapons: ['modusOperandi', 'suspectProfile', 'herkunft'],
  knife: ['herkunft', 'suspectProfile', 'victimProfile'],
  murder: ['modusOperandi', 'victimProfile', 'suspectProfile'],
  assault: ['herkunft', 'suspectProfile', 'victimProfile'],
  robbery: ['modusOperandi', 'damageReport', 'suspectProfile'],
  burglary: ['herkunft', 'damageReport', 'suspectProfile'],
  vandalism: ['damageReport', 'herkunft', 'modusOperandi'],
  drugs: ['modusOperandi', 'suspectProfile', 'herkunft'],
  fraud: ['damageReport', 'suspectProfile', 'modusOperandi'],
  arson: ['damageReport', 'herkunft', 'modusOperandi'],
  traffic: ['herkunft', 'victimProfile', 'modusOperandi'],
  missing_person: ['victimProfile', 'herkunft', 'suspectProfile'],
  other: ['herkunft', 'suspectProfile', 'modusOperandi'],
  _default: ['herkunft', 'suspectProfile', 'modusOperandi'],
};

function formatDelta(deltaPct: number): string {
  const rounded = Math.round(deltaPct);
  if (rounded > 0) return `+${rounded}%`;
  if (rounded < 0) return `${rounded}%`;
  return '0%';
}

function trendTone(deltaPct: number): string {
  if (deltaPct >= 15) return '#ef4444';
  if (deltaPct >= 5) return '#f59e0b';
  if (deltaPct <= -10) return '#22c55e';
  return 'var(--text-muted)';
}

function categoryLabel(category: CrimeCategory | null): string {
  if (!category) return 'Alle Delikte';
  return CRIME_CATEGORIES.find((item) => item.key === category)?.label ?? category;
}

function LoadingCard({ className = '' }: { className?: string }) {
  return (
    <div
      className={`h-28 animate-pulse rounded-xl border sm:rounded-2xl ${className}`}
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--loading-skeleton)' }}
    />
  );
}

interface SingleStatTileProps {
  label: string;
  value: string;
  helper: string;
  delta?: number;
  subtitle?: string;
}

function SingleStatTile({ label, value, helper, delta, subtitle }: SingleStatTileProps) {
  return (
    <article
      className="flex flex-col justify-between h-full rounded-xl border p-2.5 sm:rounded-2xl sm:p-4"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'linear-gradient(145deg, var(--card) 0%, var(--card-elevated) 100%)',
      }}
    >
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] sm:text-xs text-[var(--text-faint)]">
          {label}
        </p>
        <p className="mt-2 text-2xl font-bold tabular-nums leading-none sm:mt-4 sm:text-3xl text-[var(--text-primary)]">
          {value}
        </p>
        {subtitle && (
          <p className="mt-1 text-[10px] sm:text-xs text-[var(--text-muted)]">
            {subtitle}
          </p>
        )}
      </div>
      <div className="mt-4 flex items-end justify-between gap-2">
        <p className="text-xs sm:text-sm text-[var(--text-muted)]">
          {helper}
        </p>
        {delta !== undefined && (
          <span
            className="text-xs font-semibold tabular-nums sm:text-sm"
            style={{ color: trendTone(delta) }}
          >
            {formatDelta(delta)}
          </span>
        )}
      </div>
    </article>
  );
}

interface DenseStatTileProps {
  title: string;
  metrics: DashboardContextValue[];
}

function DenseStatTile({ title, metrics }: DenseStatTileProps) {
  return (
    <article
      className="flex flex-col rounded-xl border p-2.5 sm:rounded-2xl sm:p-4 transition-colors hover:border-[var(--border-highlight)]"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'linear-gradient(145deg, var(--card) 0%, var(--card-elevated) 100%)',
      }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] sm:text-xs mb-3 text-[var(--text-faint)]">
        {title}
      </p>

      {metrics.length === 0 ? (
        <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1">Keine Daten verfügbar</p>
      ) : (
        <div className="flex flex-col gap-2 border-l-2 border-[var(--border-subtle)] pl-2 sm:pl-3">
          {metrics.map((m, i) => (
            <div key={i} className="flex justify-between items-end group">
              <div className="flex flex-col">
                <span className="text-[9px] uppercase tracking-wider font-medium sm:text-[10px] mb-0.5 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors">{m.label}</span>
                <span className="text-sm sm:text-base font-bold tabular-nums leading-none text-[var(--text-primary)]">{m.value}</span>
              </div>
              <span className="text-[10px] sm:text-[11px] text-right whitespace-nowrap ml-2 text-[var(--text-muted)]">{m.helper}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

interface DashboardSnapshotGridProps {
  showLoading: boolean;
  focusCategory: CrimeCategory | null;
  isYearView: boolean;
  previousLabel: string;
  snapshot: SecurityOverviewResponse['snapshot'] | undefined;
  contextStats: SecurityOverviewResponse['contextStats'] | undefined;
}

export function DashboardSnapshotGrid({
  showLoading,
  focusCategory,
  isYearView,
  previousLabel,
  snapshot,
  contextStats,
}: DashboardSnapshotGridProps) {
  return (
    <section className="dashboard-rise dashboard-delay-1 grid grid-cols-2 gap-3 xl:grid-cols-4">
      {showLoading ? (
        <>
          <LoadingCard className="hidden sm:block" />
          <LoadingCard />
          <LoadingCard />
          <LoadingCard />
        </>
      ) : (
        <>
          <div className="col-span-2 sm:col-span-1">
            <SingleStatTile
              label={categoryLabel(focusCategory)}
              value={(snapshot?.focusCountCurrent ?? 0).toLocaleString('de-DE')}
              helper={isYearView ? `Gesamtes Jahr ${DASHBOARD_YEAR}` : `ggü. ${previousLabel}`}
              delta={isYearView ? undefined : snapshot?.incidentsTrendPct}
              subtitle={contextStats?.peakTime ? `Tatzeit: ${contextStats.peakTime.band} Uhr (${contextStats.peakTime.pct}%)` : undefined}
            />
          </div>
          {(CATEGORY_CARD_MAP[focusCategory ?? '_default'] ?? CATEGORY_CARD_MAP._default).map((cardType) => {
            const metrics = contextStats?.[cardType] ?? [];
            return (
              <DenseStatTile
                key={cardType}
                title={CONTEXT_CARD_LABELS[cardType]}
                metrics={metrics}
              />
            );
          })}
        </>
      )}
    </section>
  );
}
