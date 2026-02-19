'use client';

import { DASHBOARD_YEAR } from '@/lib/dashboard/timeframes';
import type { SecurityOverviewResponse } from '@/lib/dashboard/types';
import { CRIME_CATEGORIES, type CrimeCategory } from '@/lib/types/crime';

type ContextCardType = 'peakTime' | 'suspectProfile' | 'victimProfile' | 'topWeapon' | 'topMotive' | 'avgDamage' | 'topDrug';

const CONTEXT_CARD_LABELS: Record<ContextCardType, string> = {
  peakTime: 'Tatzeit-Schwerpunkt',
  suspectProfile: 'Täterprofil',
  victimProfile: 'Opferprofil',
  topWeapon: 'Häufigste Waffe',
  topMotive: 'Häufigstes Motiv',
  avgDamage: 'Durchschn. Schaden',
  topDrug: 'Häufigste Droge',
};

const CATEGORY_CARD_MAP: Record<string, [ContextCardType, ContextCardType, ContextCardType]> = {
  sexual: ['peakTime', 'suspectProfile', 'victimProfile'],
  weapons: ['topWeapon', 'suspectProfile', 'victimProfile'],
  knife: ['suspectProfile', 'victimProfile', 'peakTime'],
  murder: ['topWeapon', 'victimProfile', 'topMotive'],
  assault: ['suspectProfile', 'topMotive', 'peakTime'],
  robbery: ['topWeapon', 'avgDamage', 'suspectProfile'],
  burglary: ['peakTime', 'avgDamage', 'suspectProfile'],
  vandalism: ['avgDamage', 'peakTime', 'topMotive'],
  drugs: ['topDrug', 'suspectProfile', 'peakTime'],
  fraud: ['avgDamage', 'suspectProfile', 'topMotive'],
  arson: ['avgDamage', 'peakTime', 'topMotive'],
  traffic: ['peakTime', 'victimProfile', 'topWeapon'],
  missing_person: ['victimProfile', 'peakTime', 'suspectProfile'],
  other: ['peakTime', 'suspectProfile', 'topMotive'],
  _default: ['peakTime', 'suspectProfile', 'topWeapon'],
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
  meth: 'Crystal Meth',
  other: 'Sonstige',
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
  if (!category) return 'Alle Kategorien';
  return CRIME_CATEGORIES.find((item) => item.key === category)?.label ?? category;
}

function resolveContextCard(
  cardType: ContextCardType,
  contextStats: SecurityOverviewResponse['contextStats'],
): { label: string; value: string; helper: string } {
  const stat = contextStats[cardType];
  const label = CONTEXT_CARD_LABELS[cardType];

  if (!stat) {
    return { label, value: '–', helper: 'Keine Daten' };
  }

  let displayValue = stat.value;
  if (cardType === 'topWeapon') {
    displayValue = WEAPON_LABELS[stat.value] ?? stat.value;
  } else if (cardType === 'topMotive') {
    displayValue = MOTIVE_LABELS[stat.value] ?? stat.value;
  } else if (cardType === 'topDrug') {
    displayValue = DRUG_LABELS[stat.value] ?? stat.value;
  }

  return { label, value: displayValue, helper: stat.helper };
}

function LoadingCard({ className = '' }: { className?: string }) {
  return (
    <div
      className={`h-28 animate-pulse rounded-xl border sm:rounded-2xl ${className}`}
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--loading-skeleton)' }}
    />
  );
}

interface SnapshotTileProps {
  label: string;
  value: string;
  helper: string;
  delta?: number;
}

function SnapshotTile({ label, value, helper, delta }: SnapshotTileProps) {
  return (
    <article
      className="rounded-xl border p-2.5 sm:rounded-2xl sm:p-4"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'linear-gradient(145deg, var(--card) 0%, var(--card-elevated) 100%)',
      }}
    >
      <p className="text-[8px] font-semibold uppercase tracking-[0.2em] sm:text-[10px]" style={{ color: 'var(--text-faint)' }}>
        {label}
      </p>
      <p className="mt-1 text-lg font-bold tabular-nums leading-none sm:mt-2 sm:text-[1.7rem]" style={{ color: 'var(--text-primary)' }}>
        {value}
      </p>
      <div className="mt-1 flex items-center justify-between gap-2 sm:mt-2">
        <p className="text-[10px] sm:text-xs" style={{ color: 'var(--text-muted)' }}>
          {helper}
        </p>
        {delta !== undefined && (
          <span
            className="text-[10px] font-semibold tabular-nums sm:text-xs"
            style={{ color: trendTone(delta) }}
          >
            {formatDelta(delta)}
          </span>
        )}
      </div>
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
    <section className="dashboard-rise dashboard-delay-1 grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
      {showLoading ? (
        <>
          <LoadingCard className="hidden sm:block" />
          <LoadingCard />
          <LoadingCard />
          <LoadingCard />
        </>
      ) : (
        <>
          <div className="hidden sm:block">
            <SnapshotTile
              label={categoryLabel(focusCategory)}
              value={(snapshot?.focusCountCurrent ?? 0).toLocaleString('de-DE')}
              helper={isYearView ? `Gesamtes Jahr ${DASHBOARD_YEAR}` : `ggü. ${previousLabel}`}
              delta={isYearView ? undefined : snapshot?.incidentsTrendPct}
            />
          </div>
          {(CATEGORY_CARD_MAP[focusCategory ?? '_default'] ?? CATEGORY_CARD_MAP._default).map((cardType) => {
            const card = contextStats
              ? resolveContextCard(cardType, contextStats)
              : { label: CONTEXT_CARD_LABELS[cardType], value: '–', helper: 'Keine Daten' };
            return (
              <SnapshotTile
                key={cardType}
                label={card.label}
                value={card.value}
                helper={card.helper}
              />
            );
          })}
        </>
      )}
    </section>
  );
}
