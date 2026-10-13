import { useEffect, useState } from 'react';
import type { Lesson } from '@school/shared';
import { api } from '../api';
import { ErrorBox } from '../ui';
import { confirmAction, notifyError, notifySuccess } from '../feedback';

type LessonView = Lesson & { edit_seconds_left: number };

export function TeacherLessons() {
  const [lessons, setLessons] = useState<LessonView[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<LessonView | null>(null);
  const [duration, setDuration] = useState('');
  const [date, setDate] = useState('');
  const [comment, setComment] = useState('');

  async function load() {
    const data = await api.get<{ lessons: LessonView[] }>('/api/teacher/lessons');
    setLessons(data.lessons);
  }

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setLessons((prev) => prev.map((l) => ({
        ...l,
        edit_seconds_left: Math.max(0, l.edit_seconds_left - 1),
      })));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  async function cancel(id: string) {
    const ok = await confirmAction('Cancel this lesson? Balance will be restored.');
    if (!ok) return;
    try {
      await api.post(`/api/teacher/lessons/${id}/cancel`);
      notifySuccess('Lesson cancelled');
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      notifyError(message);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      await api.patch(`/api/teacher/lessons/${editing.lesson_id}`, {
        duration_min: duration ? Number(duration) : undefined,
        lesson_date: date || undefined,
        comment,
      });
      notifySuccess('Lesson saved');
      setEditing(null);
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      notifyError(message);
    }
  }

  return (
    <>
      <div className="header"><h1>My lessons</h1></div>
      <ErrorBox error={error} />
      {lessons.map((lesson) => (
        <div key={lesson.lesson_id} className="card">
          <div className="row">
            <div>
              <div className="title">{lesson.student_name}</div>
              <div className="small">{lesson.lesson_date} · {lesson.duration_min} min</div>
            </div>
            <span className={`badge ${lesson.state === 'done' ? 'green' : lesson.state === 'pending_photo' ? 'warn' : 'red'}`}>
              {lesson.state === 'pending_photo' ? 'Waiting for photo' : lesson.state}
            </span>
          </div>
          {lesson.comment && <div className="small">{lesson.comment}</div>}
          {lesson.state === 'pending_photo' && (
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn secondary" onClick={() => {
                setEditing(lesson);
                setDuration(String(lesson.duration_min));
                setDate(lesson.lesson_date);
                setComment(lesson.comment);
              }}>Edit</button>
              <button className="btn danger" onClick={() => cancel(lesson.lesson_id)}>Cancel</button>
            </div>
          )}
          {lesson.state === 'done' && lesson.edit_seconds_left > 0 && (
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn secondary" onClick={() => {
                setEditing(lesson);
                setDuration(String(lesson.duration_min));
                setDate(lesson.lesson_date);
                setComment(lesson.comment);
              }}>Edit · {Math.ceil(lesson.edit_seconds_left / 60)}m</button>
              <button className="btn danger" onClick={() => cancel(lesson.lesson_id)}>Cancel</button>
            </div>
          )}
        </div>
      ))}
      {!lessons.length && <p className="muted">No lessons yet.</p>}

      {editing && (
        <div className="card">
          <h2>Edit lesson</h2>
          <label>Duration</label>
          <input value={duration} onChange={(e) => setDuration(e.target.value)} />
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <label>Comment</label>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="btn secondary" onClick={() => setEditing(null)}>Close</button>
            <button className="btn" onClick={saveEdit}>Save</button>
          </div>
        </div>
      )}
    </>
  );
}
