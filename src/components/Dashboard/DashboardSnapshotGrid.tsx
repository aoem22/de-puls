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

function LoadingCard() {
  return (
    <div
      className="h-28 animate-pulse rounded-2xl border"
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
      className="rounded-2xl border p-3.5 sm:p-4"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'linear-gradient(145deg, var(--card) 0%, var(--card-elevated) 100%)',
      }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
        {label}
      </p>
      <p className="mt-2 text-[1.7rem] font-bold tabular-nums leading-none sm:text-3xl" style={{ color: 'var(--text-primary)' }}>
        {value}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {helper}
        </p>
        {delta !== undefined && (
          <span
            className="text-xs font-semibold tabular-nums"
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
    <section className="dashboard-rise dashboard-delay-1 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {showLoading ? (
        <>
          <LoadingCard />
          <LoadingCard />
          <LoadingCard />
          <LoadingCard />
        </>
      ) : (
        <>
          <SnapshotTile
            label={categoryLabel(focusCategory)}
            value={(snapshot?.focusCountCurrent ?? 0).toLocaleString('de-DE')}
            helper={isYearView ? `Gesamtes Jahr ${DASHBOARD_YEAR}` : `ggü. ${previousLabel}`}
            delta={isYearView ? undefined : snapshot?.incidentsTrendPct}
          />
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
