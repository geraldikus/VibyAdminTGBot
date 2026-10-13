import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { AppSettings, Student } from '@school/shared';
import { api } from '../api';
import { closeApp, haptic } from '../telegram';
import { ErrorBox, StatusBadge, minDateYmd, todayYmd } from '../ui';

const PRESETS = [15, 30, 45, 60, 90];

export function TeacherStudent({ settings }: { settings: AppSettings }) {
  const { id } = useParams();
  const [student, setStudent] = useState<Student | null>(null);
  const [duration, setDuration] = useState(60);
  const [custom, setCustom] = useState('');
  const [date, setDate] = useState(todayYmd());
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ student: Student }>(`/api/teacher/students/${id}`)
      .then((d) => setStudent(d.student))
      .catch((e: Error) => setError(e.message));
  }, [id]);

  async function submit() {
    if (!student) return;
    const minutes = custom ? Number(custom) : duration;
    if (!Number.isFinite(minutes) || minutes < 1) {
      setError('Enter a valid duration');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/api/teacher/lessons', {
        client_id: crypto.randomUUID(),
        student_id: student.student_id,
        duration_min: minutes,
        lesson_date: date,
        comment,
      });
      haptic('success');
      closeApp();
    } catch (e) {
      haptic('error');
      setError(e instanceof Error ? e.message : 'Failed');
      setBusy(false);
    }
  }

  if (!student) return <p className="muted">Loading…</p>;

  return (
    <>
      <div className="header"><h1>{student.name}</h1></div>
      <ErrorBox error={error} />
      <div className="card">
        <div className="row">
          <StatusBadge status={student.status} />
          <span className="muted">{student.type === 'business' ? 'Business' : `Balance ${student.balance}`}</span>
        </div>
        {student.status === 'red' && (
          <p className="small">Red status: the lesson can still be marked. Admin will be notified.</p>
        )}
      </div>

      <label>Duration</label>
      <div className="chips">
        {PRESETS.map((n) => (
          <button
            key={n}
            className={`chip ${!custom && duration === n ? 'active' : ''}`}
            onClick={() => { setDuration(n); setCustom(''); }}
          >
            {n} min
          </button>
        ))}
      </div>
      <label>Custom minutes</label>
      <input inputMode="numeric" value={custom} placeholder="e.g. 20" onChange={(e) => setCustom(e.target.value)} />

      <label>Lesson date</label>
      <input type="date" value={date} min={minDateYmd(settings.backdate_days)} max={todayYmd()} onChange={(e) => setDate(e.target.value)} />

      <label>Comment</label>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional" />

      <div style={{ height: 12 }} />
      <button className="btn" disabled={busy} onClick={submit}>
        {busy ? 'Saving…' : 'Mark lesson'}
      </button>
      <p className="small">The bot will ask you to send a photo. The lesson is counted only after the photo.</p>
    </>
  );
}
