/** Date normalisation for the Google Sheets import, independent of the sheet's locale. */
const pad = (n: number) => String(n).padStart(2, '0');

type Warn = (message: string) => void;

/** Google Sheets serial number (days since 1899-12-30) to "YYYY-MM-DD[ HH:mm:ss]". */
export function fromSerial(serial: number, withTime: boolean): string {
  const ms = Math.round((serial - 25569) * 86_400_000); // 25569 = 1970-01-01 in Sheets serials
  const d = new Date(ms);
  const ymd = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return withTime ? `${ymd} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` : ymd;
}

export function normDate(raw: unknown, ctx: string, warn: Warn = () => {}): string {
  if (raw === '' || raw == null) return '';
  if (typeof raw === 'number') return fromSerial(raw, false);
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  warn(`${ctx}: unrecognised date "${s}" kept as is`);
  return s;
}

export function normDateTime(raw: unknown, ctx: string, warn: Warn = () => {}): string {
  if (raw === '' || raw == null) return '';
  if (typeof raw === 'number') return fromSerial(raw, true);
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${pad(+m[4])}:${m[5]}:${m[6] ?? '00'}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])} ${pad(+m[4])}:${m[5]}:${m[6] ?? '00'}`;
  warn(`${ctx}: unrecognised datetime "${s}" kept as is`);
  return s;
}
