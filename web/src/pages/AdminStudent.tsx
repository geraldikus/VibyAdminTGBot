import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { BalanceEntry, Lesson, Status, Student, StudentType, Teacher } from '@school/shared';
import { api } from '../api';
import { confirmAction, notifyError, notifySuccess } from '../feedback';
import { ErrorBox, StatusBadge } from '../ui';

export function AdminStudent() {
  const { id } = useParams();
  const [student, setStudent] = useState<Student | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [balance, setBalance] = useState<BalanceEntry[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const [history, t] = await Promise.all([
      api.get<{ student: Student; lessons: Lesson[]; balance: BalanceEntry[] }>(`/api/admin/students/${id}`),
      api.get<{ teachers: Teacher[] }>('/api/admin/teachers'),
    ]);
    setStudent(history.student);
    setLessons(history.lessons);
    setBalance(history.balance);
    setTeachers(t.teachers);
  }

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [id]);

  async function patch(body: Record<string, unknown>, success?: string) {
    if (!student || busy) return;
    setBusy(true);
    try {
      const res = await api.patch<{ student: Student }>(`/api/admin/students/${student.student_id}`, body);
      setStudent(res.student);
      if (success) notifySuccess(success);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      notifyError(message);
    } finally {
      setBusy(false);
    }
  }

  async function topUp(amount: number) {
    if (!student || busy) return;
    setBusy(true);
    try {
      const res = await api.post<{ student: Student }>(`/api/admin/students/${student.student_id}/balance`, { amount });
      setStudent(res.student);
      await load();
      notifySuccess(`Balance updated: ${res.student.balance}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      notifyError(message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (!student || busy) return;
    const archiving = student.active;
    const ok = await confirmAction(
      archiving
        ? 'Archive this student? Teachers will no longer see them.'
        : 'Restore this student?',
    );
    if (!ok) return;
    await patch({ active: !student.active }, archiving ? 'Student archived' : 'Student restored');
  }

  if (!student) return <p className="muted">Loading…</p>;

  return (
    <>
      <div className="header"><h1>{student.name}</h1></div>
      <ErrorBox error={error} />
      <div className="card">
        <div className="row">
          <StatusBadge status={student.status} />
          <b>{student.type === 'business' ? 'Business' : `Balance ${student.balance}`}</b>
        </div>
      </div>

      <label>Name</label>
      <input defaultValue={student.name} onBlur={(e) => { if (e.target.value !== student.name) void patch({ name: e.target.value }, 'Name saved'); }} />
      <label>Contact</label>
      <input defaultValue={student.contact} onBlur={(e) => { if (e.target.value !== student.contact) void patch({ contact: e.target.value }, 'Contact saved'); }} />
      <label>Teacher</label>
      <select value={student.teacher_id} onChange={(e) => void patch({ teacher_id: e.target.value }, 'Teacher updated')} disabled={busy}>
        {teachers.map((t) => <option key={t.teacher_id} value={t.teacher_id}>{t.name}{t.active ? '' : ' (inactive)'}</option>)}
      </select>
      <label>Type</label>
      <select value={student.type} onChange={(e) => void patch({ type: e.target.value as StudentType }, 'Type updated')} disabled={busy}>
        <option value="subscription">Subscription</option>
        <option value="business">Business</option>
      </select>
      <label>Status</label>
      <div className="chips">
        {(['green', 'yellow', 'red', 'blue'] as Status[]).map((s) => (
          <button key={s} className={`chip ${student.status === s ? 'active' : ''}`} disabled={busy} onClick={() => void patch({ status: s }, `Status: ${s}`)}>{s}</button>
        ))}
      </div>
      <label>Notes</label>
      <textarea defaultValue={student.notes} onBlur={(e) => { if (e.target.value !== student.notes) void patch({ notes: e.target.value }, 'Notes saved'); }} />

      {student.type === 'subscription' && (
        <>
          <label>Top up balance</label>
          <div className="chips">
            {[4, 8, 12].map((n) => (
              <button key={n} className="chip" disabled={busy} onClick={() => void topUp(n)}>+{n}</button>
            ))}
          </div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <input value={custom} placeholder="Any number, can be negative" onChange={(e) => setCustom(e.target.value)} />
            <button className="btn" disabled={busy} onClick={() => { const n = Number(custom); if (n) void topUp(n); }}>Apply</button>
          </div>
        </>
      )}

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn secondary" disabled={busy} onClick={() => void toggleArchive()}>
          {student.active ? 'Archive' : 'Restore'}
        </button>
      </div>

      <h2>Lessons</h2>
      {lessons.map((l) => (
        <div key={l.lesson_id} className="card">
          <div className="row">
            <div>{l.lesson_date} · {l.duration_min} min</div>
            <span className="badge">{l.state}</span>
          </div>
          {l.photo_link && <a href={l.photo_link} target="_blank" rel="noreferrer">Photo</a>}
        </div>
      ))}

      <h2>Balance history</h2>
      {balance.map((b) => (
        <div key={b.entry_id} className="card">
          <div className="row">
            <div>{b.reason} · {b.change > 0 ? `+${b.change}` : b.change}</div>
            <div>after {b.balance_after}</div>
          </div>
          <div className="small">{b.created_at} · {b.by}</div>
        </div>
      ))}
    </>
  );
}
