import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Status, Student, StudentType, Teacher } from '@school/shared';
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
  teacher_id: '',
  type: 'subscription' as StudentType,
  status: 'green' as Status,
  balance: '0',
  notes: '',
};

export function AdminStudents() {
  const [params, setParams] = useSearchParams();
  const [students, setStudents] = useState<Student[] | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const navigate = useNavigate();

  const status = (params.get('status') ?? '') as '' | Status;
  const type = (params.get('type') ?? '') as '' | StudentType;
  const teacherId = params.get('teacher') ?? '';
  const lowBalance = params.get('balance') === 'low';

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  }

  async function load() {
    const [s, t] = await Promise.all([
      api.get<{ students: Student[] }>('/api/admin/students'),
      api.get<{ teachers: Teacher[] }>('/api/admin/teachers'),
    ]);
    setStudents(s.students);
    setTeachers(t.teachers);
  }

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  const filtered = useMemo(() => (students ?? []).filter((s) => {
    if (q && !s.name.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (status && s.status !== status) return false;
    if (type && s.type !== type) return false;
    if (teacherId && s.teacher_id !== teacherId) return false;
    if (lowBalance && !(s.type === 'subscription' && s.balance <= 0)) return false;
    return true;
  }).sort((a, b) => Number(b.active) - Number(a.active) || urgency(a) - urgency(b) || a.name.localeCompare(b.name)),
  [students, q, status, type, teacherId, lowBalance]);

  const activeTeachers = teachers.filter((t) => t.active);

  function openCreate() {
    setForm({ ...EMPTY_FORM, teacher_id: activeTeachers[0]?.teacher_id ?? '' });
    setCreating(true);
  }

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const created = await api.post<{ student: Student }>('/api/admin/students', {
        ...form,
        balance: Number(form.balance || 0),
      });
      setCreating(false);
      notifySuccess('Student created');
      navigate(`/admin/students/${created.student.student_id}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      notifyError(message);
    } finally {
      setBusy(false);
    }
  }

  const filtersOn = Boolean(status || type || teacherId || lowBalance || q);

  return (
    <>
      <PageHeader
        title="Students"
        action={<button className="icon-btn" aria-label="Add student" onClick={openCreate}><Icon name="plus" size={20} strokeWidth={2.4} /></button>}
      />
      <ErrorBox error={error} />
      <SearchInput value={q} onChange={setQ} />
      <div className="select-row">
        <select value={status} onChange={(e) => setFilter('status', e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {(['green', 'yellow', 'red', 'blue'] as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select value={type} onChange={(e) => setFilter('type', e.target.value)} aria-label="Type">
          <option value="">Any type</option>
          <option value="subscription">Subscription</option>
          <option value="business">Business</option>
        </select>
        <select value={teacherId} onChange={(e) => setFilter('teacher', e.target.value)} aria-label="Teacher">
          <option value="">Any teacher</option>
          {teachers.map((t) => <option key={t.teacher_id} value={t.teacher_id}>{t.name}</option>)}
        </select>
      </div>
      {lowBalance && (
        <div className="filters">
          <Chip active onClick={() => setFilter('balance', '')}>Balance ≤ 0 ✕</Chip>
        </div>
      )}

      {!students && !error && <SkeletonList />}
      {students && !!filtered.length && (
        <Section title={`${filtered.length} ${filtered.length === 1 ? 'student' : 'students'}`}>
          {filtered.map((s) => (
            <Cell
              key={s.student_id}
              before={<Avatar name={s.name} seed={s.student_id} />}
              title={s.name}
              subtitle={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <StatusDot status={s.status} />{s.active ? s.teacher_name : 'Archived'}
                </span>
              }
              after={<BalancePill student={s} />}
              dimmed={!s.active}
              chevron
              onClick={() => navigate(`/admin/students/${s.student_id}`)}
            />
          ))}
        </Section>
      )}
      {students && !filtered.length && (
        filtersOn
          ? <EmptyState emoji="🔍" title="Nothing found" text="Try other filters." />
          : <EmptyState emoji="🎓" title="No students yet"
              action={<button className="btn" onClick={openCreate}>Add student</button>} />
      )}

      <BottomSheet open={creating} title="New student" onClose={() => setCreating(false)}>
        <div className="form-fields">
          <label>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label>Contact</label>
          <input value={form.contact} placeholder="Phone, @username…" onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          <label>Teacher</label>
          <select value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}>
            {activeTeachers.map((t) => <option key={t.teacher_id} value={t.teacher_id}>{t.name}</option>)}
          </select>
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
              <label>Starting balance, lessons</label>
              <input inputMode="numeric" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} />
            </>
          )}
          <label>Notes</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <button className="btn mt" disabled={busy || !form.name.trim() || !form.teacher_id} onClick={() => void create()}>
          Create student
        </button>
      </BottomSheet>
    </>
  );
}
