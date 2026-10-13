import { useEffect, useState } from 'react';
import type { Lesson, Student } from '@school/shared';
import { api } from '../api';
import { confirmAction, notifyError, notifySuccess } from '../feedback';
import { ErrorBox } from '../ui';

type LessonView = Lesson & { edit_seconds_left: number };

export function AdminLessons() {
  const [lessons, setLessons] = useState<LessonView[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [state, setState] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<LessonView | null>(null);
  const [form, setForm] = useState({ duration_min: '', lesson_date: '', comment: '', student_id: '' });
  const [busy, setBusy] = useState(false);

  async function load() {
    const qs = state ? `?state=${state}` : '';
    const [l, s] = await Promise.all([
      api.get<{ lessons: LessonView[] }>(`/api/admin/lessons${qs}`),
      api.get<{ students: Student[] }>('/api/admin/students'),
    ]);
    setLessons(l.lessons);
    setStudents(s.students);
  }

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [state]);

  async function save() {
    if (!editing || busy) return;
    setBusy(true);
    try {
      await api.patch(`/api/admin/lessons/${editing.lesson_id}`, {
        duration_min: form.duration_min ? Number(form.duration_min) : undefined,
        lesson_date: form.lesson_date || undefined,
        comment: form.comment,
        student_id: form.student_id || undefined,
      });
      setEditing(null);
      await load();
      notifySuccess('Lesson saved');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      notifyError(message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelLesson(id: string) {
    if (busy) return;
    const ok = await confirmAction('Cancel this lesson? Balance will be restored.');
    if (!ok) return;
    setBusy(true);
    try {
      await api.post(`/api/admin/lessons/${id}/cancel`);
      await load();
      notifySuccess('Lesson cancelled');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      notifyError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="header"><h1>Lessons</h1></div>
      <ErrorBox error={error} />
      <div className="filters">
        {['', 'pending_photo', 'done', 'cancelled'].map((s) => (
          <button key={s || 'all'} className={`chip ${state === s ? 'active' : ''}`} onClick={() => setState(s)}>
            {s || 'All'}
          </button>
        ))}
      </div>
      {lessons.map((lesson) => (
        <div key={lesson.lesson_id} className="card">
          <div className="row">
            <div>
              <div className="title">{lesson.student_name}</div>
              <div className="small">{lesson.teacher_name} · {lesson.lesson_date} · {lesson.duration_min} min</div>
            </div>
            <span className="badge">{lesson.state}</span>
          </div>
          {lesson.photo_link && <a href={lesson.photo_link} target="_blank" rel="noreferrer">Open photo</a>}
          {lesson.state !== 'cancelled' && (
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn secondary" onClick={() => {
                setEditing(lesson);
                setForm({
                  duration_min: String(lesson.duration_min),
                  lesson_date: lesson.lesson_date,
                  comment: lesson.comment,
                  student_id: lesson.student_id,
                });
              }}>Edit</button>
              <button className="btn danger" disabled={busy} onClick={() => void cancelLesson(lesson.lesson_id)}>Cancel</button>
            </div>
          )}
        </div>
      ))}

      {editing && (
        <div className="card">
          <h2>Edit lesson</h2>
          <label>Student</label>
          <select value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })}>
            {students.map((s) => <option key={s.student_id} value={s.student_id}>{s.name}</option>)}
          </select>
          <label>Duration</label>
          <input value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })} />
          <label>Date</label>
          <input type="date" value={form.lesson_date} onChange={(e) => setForm({ ...form, lesson_date: e.target.value })} />
          <label>Comment</label>
          <textarea value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn secondary" onClick={() => setEditing(null)}>Close</button>
            <button className="btn" disabled={busy} onClick={() => void save()}>Save</button>
          </div>
        </div>
      )}
    </>
  );
}
