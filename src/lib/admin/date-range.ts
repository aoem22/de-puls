export const PERIODS = [
  { key: 'day', label: 'Tag' },
  { key: 'week', label: 'Woche' },
  { key: 'month', label: 'Monat' },
  { key: 'year', label: 'Jahr' },
] as const;

export type Period = (typeof PERIODS)[number]['key'];

function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayISO(): string {
  return toISO(new Date());
}

export function currentMonthISO(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function currentYearValue(): number {
  return new Date().getFullYear();
}

export function weekStartISO(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return toISO(date);
}

export function weekEndISO(dateStr: string): string {
  const monday = new Date(`${weekStartISO(dateStr)}T00:00:00`);
  monday.setDate(monday.getDate() + 6);
  return toISO(monday);
}

function monthEndISO(monthStr: string): string {
  const [year, month] = monthStr.split('-').map(Number);
  return toISO(new Date(year, month, 0));
}

export function computeRange(
  period: Period,
  dateVal: string,
  monthVal: string,
  yearVal: number,
): { start: string; end: string } {
  switch (period) {
    case 'day':
      return { start: dateVal, end: dateVal };
    case 'week':
      return { start: weekStartISO(dateVal), end: weekEndISO(dateVal) };
    case 'month':
      return { start: `${monthVal}-01`, end: monthEndISO(monthVal) };
    case 'year':
      return { start: `${yearVal}-01-01`, end: `${yearVal}-12-31` };
  }
}

export function formatRange(start: string, end: string, period: Period): string {
  if (period === 'day') return start;
  return `${start} \u2192 ${end}`;
}
