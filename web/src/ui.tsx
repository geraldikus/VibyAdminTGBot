import type { Status } from '@school/shared';
import { STATUS_EMOJI, STATUS_LABEL } from '@school/shared';

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge ${status}`}>{STATUS_EMOJI[status]} {STATUS_LABEL[status]}</span>;
}

export function ErrorBox({ error }: { error?: string }) {
  if (!error) return null;
  return <div className="error">{error}</div>;
}

export function todayYmd() {
  const d = new Date();
  const tz = 3 * 60;
  const local = new Date(d.getTime() + (tz + d.getTimezoneOffset()) * 60000);
  return local.toISOString().slice(0, 10);
}

export function minDateYmd(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
