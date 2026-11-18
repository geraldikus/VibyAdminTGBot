import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { notifyError, notifySuccess } from '../feedback';
import { haptic } from '../telegram';
import { Cell, ErrorBox, Icon, IconTile, PageHeader, Section, type IconName } from '../ui';

type Dash = {
  red: number;
  yellow: number;
  zeroOrNegative: number;
  pendingPhotos: number;
  students: number;
  teachers: number;
};

type Tile = { key: keyof Dash; label: string; icon: IconName; color: string; to: string; alert?: boolean };

const TILES: Tile[] = [
  { key: 'red', label: 'Not paid', icon: 'alert', color: 'var(--c-red)', to: '/admin/students?status=red', alert: true },
  { key: 'pendingPhotos', label: 'Waiting for photo', icon: 'camera', color: 'var(--c-orange)', to: '/admin/lessons?state=pending_photo', alert: true },
  { key: 'yellow', label: 'Waiting for payment', icon: 'clock', color: 'var(--c-yellow)', to: '/admin/students?status=yellow', alert: true },
  { key: 'zeroOrNegative', label: 'Balance ≤ 0', icon: 'wallet', color: '#af52de', to: '/admin/students?balance=low', alert: true },
  { key: 'students', label: 'Active students', icon: 'students', color: 'var(--c-blue)', to: '/admin/students' },
  { key: 'teachers', label: 'Active teachers', icon: 'teachers', color: 'var(--c-green)', to: '/admin/teachers' },
];

export function AdminDashboard() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const navigate = useNavigate();

  async function load() {
    const data = await api.get<{ dashboard: Dash }>('/api/admin/dashboard');
    setDash(data.dashboard);
  }

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  async function syncSheets() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean }>('/api/admin/refresh');
      await load();
      notifySuccess(res.ok ? 'Google Sheets copy updated' : 'Google Sheets copy is disabled');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      notifyError(message);
    } finally {
      setBusy(false);
    }
  }

  async function downloadBackup() {
    if (exporting) return;
    setExporting(true);
    try {
      await api.post('/api/admin/export');
      notifySuccess('Backup sent to your chat with the bot');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      notifyError(message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader title="Dashboard" />
      <ErrorBox error={error} />
      <div className="tiles">
        {TILES.map((t) => {
          const value = dash?.[t.key];
          return (
            <button
              key={t.key}
              type="button"
              className={`tile ${t.alert && value ? 'alert' : ''}`}
              style={{ ['--tile-color' as string]: t.color }}
              onClick={() => { haptic('select'); navigate(t.to); }}
            >
              <div className="tile-top">
                <div className="tile-icon" style={{ background: t.color }}><Icon name={t.icon} size={18} strokeWidth={2.1} /></div>
                <span className="cell-chevron"><Icon name="chevron" size={15} strokeWidth={2.4} /></span>
              </div>
              {value === undefined
                ? <div className="skeleton" style={{ width: 40, height: 30 }} />
                : <div className="tile-value">{value}</div>}
              <div className="tile-label">{t.label}</div>
            </button>
          );
        })}
      </div>

      <Section
        title="Tools"
        footer="Backup: the whole database as an Excel file (one sheet per table), sent to your chat with the bot."
      >
        <Cell
          before={<IconTile name="sheet" color="#34a853" />}
          title={busy ? 'Updating…' : 'Update Google Sheets copy'}
          onClick={() => void syncSheets()}
          chevron
        />
        <Cell
          before={<IconTile name="download" color="var(--c-blue)" />}
          title={exporting ? 'Preparing file…' : 'Download backup'}
          subtitle=".xlsx"
          onClick={() => void downloadBackup()}
          chevron
        />
      </Section>

      <Section footer="Reminders, edit window, how far back lessons can be marked.">
        <Cell
          before={<IconTile name="settings" color="#8e8e93" />}
          title="Settings"
          onClick={() => navigate('/admin/settings')}
          chevron
        />
      </Section>
    </>
  );
}
