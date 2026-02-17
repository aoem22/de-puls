import type { DashboardTimeframe } from '@/lib/dashboard/types';

export const DASHBOARD_YEAR = 2026;

export const DASHBOARD_TIMEFRAME_OPTIONS: Array<{ key: DashboardTimeframe; label: string }> = [
  { key: 'today', label: 'Live' },
  { key: 'yesterday', label: 'Gestern' },
  { key: 'last_week', label: 'Letzte Woche' },
  { key: 'this_month', label: 'Dieser Monat' },
  { key: 'last_month', label: 'Letzter Monat' },
  { key: 'year_to_date', label: `Jahr ${DASHBOARD_YEAR}` },
];

export const DASHBOARD_ALLOWED_TIMEFRAMES: DashboardTimeframe[] = DASHBOARD_TIMEFRAME_OPTIONS.map(
  (option) => option.key,
);

export const DASHBOARD_TIMEFRAME_LABELS: Record<DashboardTimeframe, string> =
  DASHBOARD_TIMEFRAME_OPTIONS.reduce(
    (labels, option) => {
      labels[option.key] = option.label;
      return labels;
    },
    {
      today: '',
      yesterday: '',
      last_week: '',
      this_month: '',
      last_month: '',
      year_to_date: '',
    } satisfies Record<DashboardTimeframe, string>,
  );

export const DASHBOARD_PREVIOUS_TIMEFRAME_LABELS: Record<DashboardTimeframe, string> = {
  today: 'Gestern',
  yesterday: 'Vorgestern',
  last_week: 'Vorvorwoche',
  this_month: 'Letzter Monat',
  last_month: 'Vorletzter Monat',
  year_to_date: '—',
};

export const DEFAULT_DASHBOARD_TIMEFRAME: DashboardTimeframe = 'today';
export const DEFAULT_PIPELINE_RUN = 'v1_2026';
