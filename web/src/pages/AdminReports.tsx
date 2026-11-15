import { useEffect, useState } from 'react';
import type { BusinessReportRow } from '@school/shared';
import { api } from '../api';
import { notifyError, notifySuccess } from '../feedback';
import { Avatar, Cell, EmptyState, ErrorBox, MonthPicker, PageHeader, Section, SkeletonList, currentMonth, shiftMonth } from '../ui';

export function AdminReports() {
  const [month, setMonth] = useState(shiftMonth(currentMonth(), -1));
  const [reports, setReports] = useState<BusinessReportRow[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(m: string) {
    const data = await api.get<{ reports: BusinessReportRow[] }>(`/api/admin/reports/business?month=${m}`);
    setReports(data.reports);
  }

  useEffect(() => {
    setReports(null);
    load(month).catch((e: Error) => setError(e.message));
  }, [month]);

  async function generate() {
    if (busy) return;
    setBusy(true);
    try {
      const data = await api.post<{ reports: BusinessReportRow[] }>('/api/admin/reports/business', { month });
      setReports(data.reports);
      notifySuccess('Report rebuilt and sent to admins');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      notifyError(message);
    } finally {
      setBusy(false);
    }
  }

  const totalLessons = (reports ?? []).reduce((s, r) => s + r.lessons_count, 0);
  const totalMinutes = (reports ?? []).reduce((s, r) => s + r.total_minutes, 0);

  return (
    <>
      <PageHeader title="Business report" />
      <ErrorBox error={error} />
      {/* "All months" makes no sense for a report: always keep a month selected. */}
      <MonthPicker month={month} onChange={(m) => setMonth(m || month)} />
      {!reports && !error && <SkeletonList rows={3} />}
      {reports && !!reports.length && (
        <Section
          title={`${reports.length} ${reports.length === 1 ? "client" : "clients"}`}
          after={<span className="num">{totalLessons} lessons · {Math.round(totalMinutes / 60 * 10) / 10} h</span>}
          footer={`Generated ${reports[0].generated_at.slice(0, 16)} (${reports[0].trigger}).`}
        >
          {reports.map((r) => (
            <Cell
              key={r.student_id}
              before={<Avatar name={r.student_name} seed={r.student_id} />}
              title={r.student_name}
              subtitle={`${r.teacher_name} · ${r.total_minutes} min`}
              after={<b className="num" style={{ color: 'var(--text)', fontSize: 17 }}>{r.lessons_count}</b>}
            />
          ))}
        </Section>
      )}
      {reports && !reports.length && (
        <EmptyState emoji="📊" title="No report for this month" text="Build it now from the lessons in the database." />
      )}
      <button className="btn" disabled={busy} onClick={() => void generate()}>
        {busy ? 'Building…' : reports?.length ? 'Rebuild & send' : 'Build & send'}
      </button>
    </>
  );
}
