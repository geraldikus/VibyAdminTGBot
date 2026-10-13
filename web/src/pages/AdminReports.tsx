import { useEffect, useState } from 'react';
import type { BusinessReportRow } from '@school/shared';
import { api } from '../api';
import { notifyError, notifySuccess } from '../feedback';
import { ErrorBox } from '../ui';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function prevMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function AdminReports() {
  const [month, setMonth] = useState(prevMonth());
  const [reports, setReports] = useState<BusinessReportRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await api.get<{ reports: BusinessReportRow[] }>(`/api/admin/reports/business?month=${month}`);
    setReports(data.reports);
  }

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [month]);

  return (
    <>
      <div className="header"><h1>Business report</h1></div>
      <ErrorBox error={error} />
      <label>Month</label>
      <input type="month" value={month} max={currentMonth()} onChange={(e) => setMonth(e.target.value)} />
      <div style={{ height: 10 }} />
      <button className="btn" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const data = await api.post<{ reports: BusinessReportRow[] }>('/api/admin/reports/business', { month });
          setReports(data.reports);
          notifySuccess('Report sent');
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Failed';
          setError(message);
          notifyError(message);
        } finally {
          setBusy(false);
        }
      }}>{busy ? 'Generating…' : 'Generate & send'}</button>
      <div style={{ height: 12 }} />
      {reports.map((r) => (
        <div key={`${r.month}-${r.student_id}-${r.generated_at}`} className="card">
          <div className="row">
            <div className="title">{r.student_name}</div>
            <b>{r.lessons_count}</b>
          </div>
          <div className="small">{r.teacher_name} · {r.total_minutes} min · {r.trigger}</div>
        </div>
      ))}
      {!reports.length && <p className="muted">No saved report for this month yet.</p>}
    </>
  );
}
