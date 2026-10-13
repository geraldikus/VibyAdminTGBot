import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Status, Student, StudentType, Teacher } from '@school/shared';
import { api } from '../api';
import { ErrorBox, StatusBadge } from '../ui';

export function AdminStudents() {
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | Status>('');
  const [type, setType] = useState<'' | StudentType>('');
  const [teacherId, setTeacherId] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    contact: '',
    teacher_id: '',
    type: 'subscription' as StudentType,
    status: 'green' as Status,
    balance: '0',
    notes: '',
  });
  const navigate = useNavigate();

  async function load() {
    const [s, t] = await Promise.all([
      api.get<{ students: Student[] }>('/api/admin/students'),
      api.get<{ teachers: Teacher[] }>('/api/admin/teachers'),
    ]);
    setStudents(s.students);
    setTeachers(t.teachers);
    if (!form.teacher_id && t.teachers[0]) {
      setForm((f) => ({ ...f, teacher_id: t.teachers.find((x) => x.active)?.teacher_id ?? t.teachers[0].teacher_id }));
    }
  }

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  const filtered = useMemo(() => students.filter((s) => {
    if (q && !s.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (status && s.status !== status) return false;
    if (type && s.type !== type) return false;
    if (teacherId && s.teacher_id !== teacherId) return false;
    return true;
  }), [students, q, status, type, teacherId]);

  async function create() {
    try {
      const created = await api.post<{ student: Student }>('/api/admin/students', {
        ...form,
        balance: Number(form.balance || 0),
      });
      setCreating(false);
      navigate(`/admin/students/${created.student.student_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  return (
    <>
      <div className="header">
        <h1>Students</h1>
        <button className="chip active" onClick={() => setCreating((v) => !v)}>{creating ? 'Close' : 'Add'}</button>
      </div>
      <ErrorBox error={error} />
      <input className="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="filters">
        {(['', 'green', 'yellow', 'red', 'blue'] as const).map((s) => (
          <button key={s || 'all'} className={`chip ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>
            {s || 'All statuses'}
          </button>
        ))}
      </div>
      <div className="filters">
        <button className={`chip ${type === '' ? 'active' : ''}`} onClick={() => setType('')}>All types</button>
        <button className={`chip ${type === 'subscription' ? 'active' : ''}`} onClick={() => setType('subscription')}>Subscription</button>
        <button className={`chip ${type === 'business' ? 'active' : ''}`} onClick={() => setType('business')}>Business</button>
      </div>
      <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
        <option value="">All teachers</option>
        {teachers.map((t) => <option key={t.teacher_id} value={t.teacher_id}>{t.name}</option>)}
      </select>
      <div style={{ height: 10 }} />

      {creating && (
        <div className="card">
          <label>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label>Contact</label>
          <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          <label>Teacher</label>
          <select value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}>
            {teachers.filter((t) => t.active).map((t) => <option key={t.teacher_id} value={t.teacher_id}>{t.name}</option>)}
          </select>
          <label>Type</label>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as StudentType })}>
            <option value="subscription">Subscription</option>
            <option value="business">Business</option>
          </select>
          <label>Status</label>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Status })}>
            <option value="green">Green · Paid</option>
            <option value="yellow">Yellow · Waiting</option>
            <option value="red">Red · Not paid</option>
            <option value="blue">Blue · Business</option>
          </select>
          <label>Balance</label>
          <input value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} />
          <label>Notes</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div style={{ height: 8 }} />
          <button className="btn" onClick={create}>Create student</button>
        </div>
      )}

      {filtered.map((student) => (
        <div key={student.student_id} className="card clickable" onClick={() => navigate(`/admin/students/${student.student_id}`)}>
          <div className="row">
            <div>
              <div className="title">{student.name}{!student.active ? ' (archived)' : ''}</div>
              <div className="small">{student.teacher_name} · {student.type === 'business' ? 'Business' : `Balance ${student.balance}`}</div>
            </div>
            <StatusBadge status={student.status} />
          </div>
        </div>
      ))}
    </>
  );
}
