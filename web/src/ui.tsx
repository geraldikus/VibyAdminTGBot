import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Status, Student } from '@school/shared';
import { STATUS_LABEL } from '@school/shared';
import { registerFeedback } from './feedback';
import { haptic, inTelegram, tg } from './telegram';

/* ---------------------------------------------------------------- dates */

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

export function currentMonth() {
  return todayYmd().slice(0, 7);
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function shiftDay(ymd: string, delta: number) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** "Today", "Yesterday", "Mon, 12 Nov" (year added if not current). */
export function dayLabel(ymd: string) {
  const today = todayYmd();
  if (ymd === today) return 'Today';
  if (ymd === shiftDay(today, -1)) return 'Yesterday';
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: ymd.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
    timeZone: 'UTC',
  });
}

export function groupBy<T>(items: T[], key: (item: T) => string): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return [...map.entries()];
}

/* ---------------------------------------------------------------- icons */

const ICONS: Record<string, ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h5v-6h4v6h5V9.5" /></>,
  students: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M16.5 14.6c2.6.2 4.4 1.8 5 4.9" /></>,
  teachers: <><path d="M2 9l10-5 10 5-10 5z" /><path d="M6 11v5c2 2 10 2 12 0v-5" /><path d="M22 9v6" /></>,
  lessons: <><rect x="3" y="4.5" width="18" height="16" rx="3" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></>,
  reports: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  left: <path d="M15 5l-7 7 7 7" />,
  right: <path d="M9 5l7 7-7 7" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  alert: <><path d="M12 3.5 2.5 20h19z" /><path d="M12 10v4.5M12 17.5v.01" /></>,
  wallet: <><rect x="3" y="6" width="18" height="14" rx="3" /><path d="M3 10h18M16 15h2" /></>,
  sheet: <><rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="M4 9h16M4 15h16M10 3v18" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  download: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19h14" /></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v10h14V9M10 13h4" /></>,
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22, strokeWidth = 1.9 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/* ---------------------------------------------------------------- avatar */

const AVATAR_COLORS: Array<[string, string]> = [
  ['#ff885e', '#ff516a'],
  ['#ffcd6a', '#ffa85c'],
  ['#82b1ff', '#665fff'],
  ['#a0de7e', '#54cb68'],
  ['#53edd6', '#28c9b7'],
  ['#72d5fd', '#2a9ef1'],
  ['#e0a2f3', '#d669ed'],
];

function hash(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function Avatar({ name, seed, size }: { name: string; seed?: string; size?: 'lg' }) {
  const [a1, a2] = AVATAR_COLORS[hash(seed ?? name) % AVATAR_COLORS.length];
  return (
    <div className={`avatar ${size ?? ''}`} style={{ ['--a1' as string]: a1, ['--a2' as string]: a2 }}>
      {initials(name)}
    </div>
  );
}

export function IconTile({ name, color }: { name: IconName; color: string }) {
  return (
    <div className="avatar icon" style={{ ['--a2' as string]: color }}>
      <Icon name={name} size={18} strokeWidth={2.1} />
    </div>
  );
}

/* ---------------------------------------------------------------- status */

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge ${status}`}><span className={`dot ${status}`} />{STATUS_LABEL[status]}</span>;
}

export function StatusDot({ status }: { status: Status }) {
  return <span className={`dot ${status}`} title={STATUS_LABEL[status]} />;
}

/** "4 left" pill, yellow at 1, red at 0 or below. */
export function BalancePill({ student }: { student: Student }) {
  if (student.type === 'business') return <span className="badge blue">Business</span>;
  const b = student.balance;
  const tone = b <= 0 ? 'red' : b <= 1 ? 'yellow' : '';
  return <span className={`badge num ${tone}`}>{b} left</span>;
}

/** Most urgent first: red, then low balance, then by name. */
export function urgency(s: Student) {
  if (s.status === 'red') return 0;
  if (s.type === 'subscription' && s.balance <= 1) return 1;
  if (s.status === 'yellow') return 2;
  return 3;
}

/* ---------------------------------------------------------------- layout */

export function ErrorBox({ error }: { error?: string }) {
  if (!error) return null;
  return <div className="error">{error}</div>;
}

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="header"><h1>{title}</h1>{action}</div>;
}

export function Section({ title, after, footer, padded, children }: {
  title?: ReactNode;
  after?: ReactNode;
  footer?: ReactNode;
  padded?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="section">
      {(title || after) && <div className="section-title"><span>{title}</span>{after && <span>{after}</span>}</div>}
      <div className={`section-body ${padded ? 'padded' : ''}`}>{children}</div>
      {footer && <div className="section-footer">{footer}</div>}
    </div>
  );
}

export function Cell({ before, title, subtitle, after, onClick, chevron, tone, dimmed }: {
  before?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  after?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  tone?: 'destructive' | 'accent';
  dimmed?: boolean;
}) {
  const className = ['cell', onClick ? 'clickable' : '', before ? 'has-before' : '', tone ?? '', dimmed ? 'muted-cell' : '']
    .filter(Boolean).join(' ');
  const content = (
    <>
      {before && <div className="cell-before">{before}</div>}
      <div className="cell-main">
        <div className="cell-title">{title}</div>
        {subtitle && <div className="cell-subtitle">{subtitle}</div>}
      </div>
      {(after || chevron) && (
        <div className="cell-after">
          {after}
          {chevron && <span className="cell-chevron"><Icon name="chevron" size={16} strokeWidth={2.4} /></span>}
        </div>
      )}
    </>
  );
  if (!onClick) return <div className={className}>{content}</div>;
  return (
    <button type="button" className={className} onClick={() => { haptic('select'); onClick(); }}>
      {content}
    </button>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search' }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-wrap">
      <span className="search-icon"><Icon name="search" size={17} /></span>
      <input type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function Chip({ active, onClick, children, disabled }: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button type="button" className={`chip ${active ? 'active' : ''}`} disabled={disabled}
      onClick={() => { haptic('select'); onClick(); }}>
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v || 'all'} type="button" className={value === v ? 'active' : ''}
          onClick={() => { haptic('select'); onChange(v); }}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function SkeletonList({ rows = 5, avatar = true }: { rows?: number; avatar?: boolean }) {
  return (
    <div className="section">
      <div className="section-body">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton-cell">
            {avatar && <div className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%' }} />}
            <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ width: `${55 + ((i * 17) % 30)}%`, height: 14, marginBottom: 7 }} />
              <div className="skeleton" style={{ width: '35%', height: 11 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ emoji, title, text, action }: {
  emoji: string;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="emoji">{emoji}</div>
      <div className="empty-title">{title}</div>
      {text && <div>{text}</div>}
      {action}
    </div>
  );
}

/** Month filter for lesson lists. Empty string = all months. */
export function MonthPicker({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const base = month || currentMonth();
  const label = month
    ? new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : 'All months';
  return (
    <div className="filters">
      <Chip onClick={() => onChange(shiftMonth(base, -1))}><Icon name="left" size={16} strokeWidth={2.4} /></Chip>
      <Chip active={!!month} onClick={() => onChange(month ? '' : currentMonth())}>{label}</Chip>
      <Chip disabled={!!month && month >= currentMonth()} onClick={() => onChange(shiftMonth(base, 1))}>
        <Icon name="right" size={16} strokeWidth={2.4} />
      </Chip>
    </div>
  );
}

/* ---------------------------------------------------------------- Telegram buttons */

const backStack: Array<{ current: () => void }> = [];
let backInstalled = false;

function syncBackButton() {
  const app = tg();
  if (!app || !inTelegram()) return;
  if (backStack.length) app.BackButton.show();
  else app.BackButton.hide();
}

/**
 * Telegram BackButton with a stack: the most recently opened screen or sheet
 * handles the press (a sheet closes before the page navigates back).
 */
export function useBackButton(handler: () => void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const app = tg();
    if (!enabled || !app || !inTelegram()) return;
    if (!backInstalled) {
      app.BackButton.onClick(() => backStack.at(-1)?.current());
      backInstalled = true;
    }
    backStack.push(ref);
    syncBackButton();
    return () => {
      const i = backStack.lastIndexOf(ref);
      if (i >= 0) backStack.splice(i, 1);
      syncBackButton();
    };
  }, [enabled]);
}

/**
 * Native Telegram MainButton. Returns false outside Telegram, so the page can
 * render a regular button instead.
 */
export function useMainButton(text: string, onClick: () => void, opts: {
  visible?: boolean;
  disabled?: boolean;
  progress?: boolean;
} = {}) {
  const { visible = true, disabled = false, progress = false } = opts;
  const native = inTelegram();
  const ref = useRef(onClick);
  ref.current = onClick;

  useEffect(() => {
    const mb = tg()?.MainButton;
    if (!native || !mb) return;
    const handler = () => ref.current();
    mb.onClick(handler);
    return () => {
      mb.offClick(handler);
      mb.hideProgress();
      mb.hide();
    };
  }, [native]);

  useEffect(() => {
    const mb = tg()?.MainButton;
    if (!native || !mb) return;
    mb.setText(text);
    if (visible) mb.show(); else mb.hide();
    if (disabled) mb.disable(); else mb.enable();
    if (progress) mb.showProgress(false); else mb.hideProgress();
  }, [native, text, visible, disabled, progress]);

  return native;
}

/* ---------------------------------------------------------------- sheets & feedback */

export function BottomSheet({ open, title, onClose, children }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useBackButton(onClose, open);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grabber" />
        <div className="sheet-header">
          <h2>{title}</h2>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={16} strokeWidth={2.4} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FeedbackHost() {
  const [toast, setToast] = useState('');
  const [dialog, setDialog] = useState<{ message: string; resolve: (ok: boolean) => void } | null>(null);

  useEffect(() => {
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    const unregister = registerFeedback({
      toast: (message) => {
        setToast(message);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => setToast(''), 2200);
      },
      confirm: (message) => new Promise((resolve) => {
        setDialog({
          message,
          resolve: (ok) => {
            setDialog(null);
            resolve(ok);
          },
        });
      }),
    });
    return () => {
      clearTimeout(toastTimer);
      unregister();
    };
  }, []);

  return (
    <>
      {toast && <div className="toast" role="status">{toast}</div>}
      {dialog && (
        <div className="modal-backdrop" onClick={() => dialog.resolve(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p>{dialog.message}</p>
            <div className="btn-row">
              <button className="btn secondary" onClick={() => dialog.resolve(false)}>Cancel</button>
              <button className="btn" onClick={() => dialog.resolve(true)}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
