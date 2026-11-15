import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Status, Student, StudentType } from '@school/shared';
import { STATUS_LABEL } from '@school/shared';
import { api } from '../api';
import { notifyError, notifySuccess } from '../feedback';
import {
  Avatar, BalancePill, BottomSheet, Cell, Chip, EmptyState, ErrorBox, Icon, PageHeader, SearchInput, Section,
  SkeletonList, StatusDot, urgency,
} from '../ui';

const EMPTY_FORM = {
  name: '',
  contact: '',
  type: 'subscription' as StudentType,
  status: 'green' as Status,
  balance: '0',
  notes: '',
};

export function TeacherStudents() {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const navigate = useNavigate();

  const balance = Number(form.balance || 0);
  const balanceValid = form.type === 'business' || (Number.isInteger(balance) && balance >= 0 && balance <= 200);

  function openCreate() {
    setForm(EMPTY_FORM);
    setCreating(true);
  }

  async function create() {
    if (busy || !form.name.trim() || !balanceValid) return;
    setBusy(true);
    try {
      const created = await api.post<{ student: Student }>('/api/teacher/students', {
        name: form.name.trim(),
        contact: form.contact,
        type: form.type,
        status: form.status,
        balance: form.type === 'business' ? 0 : balance,
        notes: form.notes,
      });
      setCreating(false);
      notifySuccess('Student added');
      navigate(`/students/${created.student.student_id}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      notifyError(message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    api.get<{ students: Student[] }>('/api/teacher/students')
      .then((d) => setStudents(d.students))
      .catch((e: Error) => setError(e.message));
  }, []);

  const filtered = useMemo(
    () => (students ?? [])
      .filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()))
      .sort((a, b) => urgency(a) - urgency(b) || a.name.localeCompare(b.name)),
    [students, q],
  );

  return (
    <>
      <PageHeader
        title="My students"
        action={<button className="icon-btn" aria-label="Add student" onClick={openCreate}><Icon name="plus" size={20} strokeWidth={2.4} /></button>}
      />
      <ErrorBox error={error} />
      {students && students.length > 5 && <SearchInput value={q} onChange={setQ} />}
      {!students && !error && <SkeletonList />}
      {students && !!filtered.length && (
        <Section title={`${filtered.length} ${filtered.length === 1 ? 'student' : 'students'}`} footer="Tap a student to mark a lesson.">
          {filtered.map((s) => (
            <Cell
              key={s.student_id}
              before={<Avatar name={s.name} seed={s.student_id} />}
              title={s.name}
              subtitle={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><StatusDot status={s.status} />{STATUS_LABEL[s.status]}</span>}
              after={<BalancePill student={s} />}
              chevron
              onClick={() => navigate(`/students/${s.student_id}`)}
            />
          ))}
        </Section>
      )}
      {students && !filtered.length && (
        q
          ? <EmptyState emoji="🔍" title="Nothing found" text={`No students match “${q}”.`} />
          : <EmptyState emoji="🎓" title="No students yet" text="Add your first student or ask the admin to assign one."
              action={<button className="btn" onClick={openCreate}>Add student</button>} />
      )}

      <BottomSheet open={creating} title="New student" onClose={() => setCreating(false)}>
        <div className="form-fields">
          <label>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label>Contact</label>
          <input value={form.contact} placeholder="Phone, @username…" onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          <label>Type</label>
          <div className="chips">
            <Chip active={form.type === 'subscription'} onClick={() => setForm({ ...form, type: 'subscription', status: 'green' })}>Subscription</Chip>
            <Chip active={form.type === 'business'} onClick={() => setForm({ ...form, type: 'business', status: 'blue' })}>Business</Chip>
          </div>
          <label>Status</label>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Status })}>
            {(['green', 'yellow', 'red', 'blue'] as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          {form.type === 'subscription' && (
            <>
              <label>Paid lessons (balance)</label>
              <input inputMode="numeric" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} />
              {!balanceValid && <div className="small" style={{ color: 'var(--destructive)', marginTop: 6 }}>Whole number from 0 to 200</div>}
            </>
          )}
          <label>Notes</label>
          <textarea value={form.notes} placeholder="Optional" onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <p className="small" style={{ marginTop: 10 }}>The admin will be notified about the new student.</p>
        <button className="btn mt" disabled={busy || !form.name.trim() || !balanceValid} onClick={() => void create()}>
          {busy ? 'Adding…' : 'Add student'}
        </button>
      </BottomSheet>
    </>
  );
}
