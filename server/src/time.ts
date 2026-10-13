const DEFAULT_TZ = 'Europe/Moscow';

export function nowIso(timezone = DEFAULT_TZ): string {
  return formatDateTime(new Date(), timezone);
}

export function todayYmd(timezone = DEFAULT_TZ): string {
  return formatYmd(new Date(), timezone);
}

export function formatYmd(date: Date, timezone = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatDateTime(date: Date, timezone = DEFAULT_TZ): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

export function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function daysBetweenYmd(from: string, to: string): number {
  const a = parseYmd(from).getTime();
  const b = parseYmd(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function previousMonth(ymdOrMonth?: string, timezone = DEFAULT_TZ): string {
  const base = ymdOrMonth ?? todayYmd(timezone);
  const [y, m] = base.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 2, 1));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${month}-${String(last).padStart(2, '0')}`;
  return { start, end };
}

export function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function minutesAgo(isoLike: string, timezone = DEFAULT_TZ): number {
  const parsed = Date.parse(isoLike.replace(' ', 'T') + '+03:00');
  if (Number.isNaN(parsed)) return Number.POSITIVE_INFINITY;
  return (Date.now() - parsed) / 60_000;
}

export { DEFAULT_TZ };
