import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { AppSettings, Student } from '@school/shared';
import { api } from '../api';
import { closeApp, haptic } from '../telegram';
import {
  Avatar, BalancePill, Chip, ErrorBox, Section, SkeletonList, StatusBadge, minDateYmd, todayYmd, useMainButton,
} from '../ui';

const PRESETS = [30, 45, 60, 90, 120];

export function TeacherStudent({ settings }: { settings: AppSettings }) {
  const { id } = useParams();
  const [student, setStudent] = useState<Student | null>(null);
  const [duration, setDuration] = useState(60);
  const [custom, setCustom] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [date, setDate] = useState(todayYmd());
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // One id per lesson attempt: a retry after a lost response reuses it, so the
  // server returns the already-created lesson instead of making a second one.
  const clientId = useRef(crypto.randomUUID());

  useEffect(() => {
    api.get<{ student: Student }>(`/api/teacher/students/${id}`)
      .then((d) => setStudent(d.student))
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const minutes = showCustom ? Number(custom) : duration;

  async function submit() {
    if (!student || busy) return;
    if (!Number.isFinite(minutes) || minutes < 1) {
      setError('Enter a valid duration');
      haptic('error');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/api/teacher/lessons', {
        client_id: clientId.current,
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

  const native = useMainButton(
    `Mark lesson · ${Number.isFinite(minutes) && minutes > 0 ? `${minutes} min` : '—'}`,
    () => void submit(),
    { visible: !!student, disabled: busy, progress: busy },
  );

  if (!student) return error ? <ErrorBox error={error} /> : <SkeletonList rows={3} />;

  return (
    <>
      <div className="profile">
        <Avatar name={student.name} seed={student.student_id} size="lg" />
        <h1>{student.name}</h1>
        <div className="meta">
          <StatusBadge status={student.status} />
          <BalancePill student={student} />
        </div>
      </div>
      <ErrorBox error={error} />
      {student.status === 'red' && (
        <div className="banner red">You can still mark the lesson. The admin will be notified.</div>
      )}

      <Section title="Duration" padded>
          <div className="chip-grid">
            {PRESETS.map((n) => (
              <Chip key={n} active={!showCustom && duration === n} onClick={() => { setDuration(n); setShowCustom(false); }}>
                {n} min
              </Chip>
            ))}
            <Chip active={showCustom} onClick={() => setShowCustom(true)}>Other</Chip>
          </div>
          {showCustom && (
            <input className="mt" inputMode="numeric" autoFocus value={custom} placeholder="Minutes, e.g. 20"
              onChange={(e) => setCustom(e.target.value)} />
          )}
      </Section>

      <Section title="Details" padded footer="The bot will ask for a photo. The lesson counts only after the photo is sent.">
        <div className="form-fields">
          <label>Lesson date</label>
          <input type="date" value={date} min={minDateYmd(settings.backdate_days)} max={todayYmd()}
            onChange={(e) => setDate(e.target.value)} />
          <label>Comment</label>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional" />
        </div>
      </Section>

      {!native && (
        <button className="btn" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Saving…' : `Mark lesson · ${minutes || '—'} min`}
        </button>
      )}
    </>
  );
}
