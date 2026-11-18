import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { BalanceEntry, Lesson, Status, Student, StudentType, Teacher } from '@school/shared';
import { STATUS_LABEL } from '@school/shared';
import { api } from '../api';
import { confirmAction, notifyError, notifySuccess } from '../feedback';
import {
  Avatar, BalancePill, BottomSheet, Cell, Chip, ErrorBox, IconTile, Section, Segmented, SkeletonList, StatusBadge, dayLabel, todayYmd,
} from '../ui';
import { LessonStateIcon, lessonStateLabel } from '../lessonUi';

const REASON_LABEL: Record<string, string> = {
  top_up: 'Top-up',
  lesson: 'Lesson',
  lesson_cancel: 'Lesson cancelled',
  lesson_moved: 'Lesson moved',
  manual: 'Manual',
};

export function AdminStudent() {
  const { id } = useParams();
  const [student, setStudent] = useState<Student | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [balance, setBalance] = useState<BalanceEntry[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [tab, setTab] = useState<'lessons' | 'balance'>('lessons');
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
    if (!student || busy || !amount) return;
    setBusy(true);
    try {
      const res = await api.post<{ student: Student }>(`/api/admin/students/${student.student_id}/balance`, { amount });
      setStudent(res.student);
      await load();
      setTopUpOpen(false);
      setCustom('');
      notifySuccess(`Balance: ${res.student.balance}`);
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
      archiving ? 'Archive this student? Teachers will no longer see them.' : 'Restore this student?',
    );
    if (!ok) return;
    await patch({ active: !student.active }, archiving ? 'Student archived' : 'Student restored');
  }

  if (!student) return error ? <ErrorBox error={error} /> : <SkeletonList rows={4} />;

  const isSub = student.type === 'subscription';

  return (
    <>
      <div className="profile">
        <Avatar name={student.name} seed={student.student_id} size="lg" />
        <h1>{student.name}</h1>
        <div className="meta">
          <StatusBadge status={student.status} />
          <BalancePill student={student} />
          {!student.active && <span className="badge">Archived</span>}
        </div>
      </div>
      <ErrorBox error={error} />

      {isSub && (
        <Section title="Balance">
          <Cell
            before={<IconTile name="wallet" color="#af52de" />}
            title="Lessons left"
            after={<b className="num" style={{ color: 'var(--text)', fontSize: 17 }}>{student.balance}</b>}
          />
          <Cell tone="accent" title="Top up balance" onClick={() => setTopUpOpen(true)} chevron />
        </Section>
      )}

      <Section
        title="Status"
        footer={student.status === 'yellow' && student.payment_wait_since
          ? `Waiting for payment since ${waitingSince(student.payment_wait_since)}.`
          : undefined}
      >
        <div style={{ padding: '10px 12px 0' }}>
          <Segmented<Status>
            value={student.status}
            options={[['green', 'Paid'], ['yellow', 'Waiting'], ['red', 'Unpaid'], ['blue', 'Business']]}
            onChange={(s) => void patch({ status: s }, `Status: ${STATUS_LABEL[s]}`)}
          />
        </div>
      </Section>

      <Section title="Details" padded>
        <div className="form-fields">
          <label>Name</label>
          <input defaultValue={student.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== student.name) void patch({ name: e.target.value }, 'Name saved'); }} />
          <label>Contact</label>
          <input defaultValue={student.contact} placeholder="Phone, @username…" onBlur={(e) => { if (e.target.value !== student.contact) void patch({ contact: e.target.value }, 'Contact saved'); }} />
          <label>Teacher</label>
          <select value={student.teacher_id} disabled={busy} onChange={(e) => void patch({ teacher_id: e.target.value }, 'Teacher updated')}>
            {teachers.map((t) => <option key={t.teacher_id} value={t.teacher_id}>{t.name}{t.active ? '' : ' (inactive)'}</option>)}
          </select>
          <label>Type</label>
          <select value={student.type} disabled={busy} onChange={(e) => void patch({ type: e.target.value as StudentType }, 'Type updated')}>
            <option value="subscription">Subscription</option>
            <option value="business">Business</option>
          </select>
          <label>Notes</label>
          <textarea defaultValue={student.notes} placeholder="Visible to admins only" onBlur={(e) => { if (e.target.value !== student.notes) void patch({ notes: e.target.value }, 'Notes saved'); }} />
        </div>
      </Section>

      <Segmented<'lessons' | 'balance'>
        value={tab}
        options={[['lessons', `Lessons · ${lessons.length}`], ['balance', `Balance history · ${balance.length}`]]}
        onChange={setTab}
      />
      {tab === 'lessons' && (
        <Section>
          {lessons.map((l) => (
            <Cell
              key={l.lesson_id}
              before={<LessonStateIcon state={l.state} />}
              title={`${dayLabel(l.lesson_date)} · ${l.duration_min} min`}
              subtitle={[lessonStateLabel(l.state), l.teacher_name].join(' · ')}
              dimmed={l.state === 'cancelled'}
              after={l.photo_link ? <a href={l.photo_link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Photo</a> : undefined}
            />
          ))}
          {!lessons.length && <Cell title={<span className="muted">No lessons yet</span>} />}
        </Section>
      )}
      {tab === 'balance' && (
        <Section>
          {balance.map((b) => (
            <Cell
              key={b.entry_id}
              title={REASON_LABEL[b.reason] ?? b.reason}
              subtitle={`${b.created_at.slice(0, 16)} · ${b.by}`}
              after={
                <span className="num" style={{ textAlign: 'right' }}>
                  <b style={{ color: b.change > 0 ? 'var(--c-green)' : 'var(--text)' }}>{b.change > 0 ? `+${b.change}` : b.change}</b>
                  <span className="small"> → {b.balance_after}</span>
                </span>
              }
            />
          ))}
          {!balance.length && <Cell title={<span className="muted">No balance changes yet</span>} />}
        </Section>
      )}

      <Section>
        <Cell
          tone={student.active ? 'destructive' : 'accent'}
          title={student.active ? 'Archive student' : 'Restore student'}
          onClick={() => void toggleArchive()}
        />
      </Section>

      <BottomSheet open={topUpOpen} title="Top up balance" onClose={() => setTopUpOpen(false)}>
        <div className="chip-grid">
          {[4, 8, 12].map((n) => <Chip key={n} disabled={busy} onClick={() => void topUp(n)}>+{n}</Chip>)}
        </div>
        <label>Other amount (can be negative to correct)</label>
        <div className="btn-row tight">
          <input inputMode="numeric" value={custom} placeholder="e.g. 6 or -1" onChange={(e) => setCustom(e.target.value)} />
          <button className="btn" style={{ width: 'auto' }} disabled={busy || !Number(custom)} onClick={() => void topUp(Number(custom))}>Apply</button>
        </div>
        <p className="small" style={{ marginTop: 12 }}>Current balance: {student.balance}. A positive top-up clears the red status.</p>
      </BottomSheet>
    </>
  );
}

function waitingSince(dateTime: string): string {
  const ymd = dateTime.slice(0, 10);
  const days = Math.round((Date.parse(todayYmd()) - Date.parse(ymd)) / 86_400_000);
  const date = new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (days <= 0) return `${date} (today)`;
  return `${date} (${days} ${days === 1 ? 'day' : 'days'})`;
}
