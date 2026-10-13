import { useEffect, useState } from 'react';
import { api } from '../api';
import { notifyError, notifySuccess } from '../feedback';
import { ErrorBox } from '../ui';

type Dash = {
  red: number;
  yellow: number;
  zeroOrNegative: number;
  pendingPhotos: number;
  students: number;
  teachers: number;
};

export function AdminDashboard() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await api.get<{ dashboard: Dash }>('/api/admin/dashboard');
    setDash(data.dashboard);
  }

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <div className="header"><h1>Dashboard</h1></div>
      <ErrorBox error={error} />
      {dash && (
        <div className="kpi">
          <div className="card"><span className="small">Red</span><b>{dash.red}</b></div>
          <div className="card"><span className="small">Yellow</span><b>{dash.yellow}</b></div>
          <div className="card"><span className="small">Balance ≤ 0</span><b>{dash.zeroOrNegative}</b></div>
          <div className="card"><span className="small">No photo</span><b>{dash.pendingPhotos}</b></div>
          <div className="card"><span className="small">Students</span><b>{dash.students}</b></div>
          <div className="card"><span className="small">Teachers</span><b>{dash.teachers}</b></div>
        </div>
      )}
      <div style={{ height: 12 }} />
      <button className="btn secondary" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          await api.post('/api/admin/refresh');
          await load();
          notifySuccess('Sheets refreshed');
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Failed';
          setError(message);
          notifyError(message);
        } finally {
          setBusy(false);
        }
      }}>{busy ? 'Refreshing…' : 'Refresh from Google Sheets'}</button>
    </>
  );
}
