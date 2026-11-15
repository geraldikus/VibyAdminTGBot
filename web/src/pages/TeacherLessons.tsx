import { useEffect, useState } from 'react';
import { api } from '../api';
import { confirmAction, notifyError, notifySuccess } from '../feedback';
import { Cell, EmptyState, ErrorBox, MonthPicker, PageHeader, Section, SkeletonList, currentMonth } from '../ui';
import {
  LessonEditSheet, LessonStateIcon, PendingBanner, groupByDay, lessonStateLabel, type LessonEditValues, type LessonView,
} from '../lessonUi';

function canChange(l: LessonView) {
  return l.state === 'pending_photo' || (l.state === 'done' && l.edit_seconds_left > 0);
}

export function TeacherLessons() {
  const [lessons, setLessons] = useState<LessonView[] | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<LessonView | null>(null);
  const [busy, setBusy] = useState(false);

  function lessonsUrl(before?: string) {
    const qs = new URLSearchParams();
    if (month) qs.set('month', month);
    if (before) qs.set('before', before);
    return `/api/teacher/lessons?${qs}`;
  }

  async function load() {
    const data = await api.get<{ lessons: LessonView[]; next_cursor: string | null }>(lessonsUrl());
    setLessons(data.lessons);
    setCursor(data.next_cursor);
  }

  async function loadMore() {
    if (!cursor) return;
    try {
      const data = await api.get<{ lessons: LessonView[]; next_cursor: string | null }>(lessonsUrl(cursor));
      setLessons((prev) => [...(prev ?? []), ...data.lessons]);
      setCursor(data.next_cursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  useEffect(() => {
    setLessons(null);
    load().catch((e: Error) => setError(e.message));
  }, [month]);

  // Edit countdown for recently confirmed lessons.
  useEffect(() => {
    const t = setInterval(() => {
      setLessons((prev) => prev && prev.map((l) => (
        l.edit_seconds_left > 0 ? { ...l, edit_seconds_left: l.edit_seconds_left - 1 } : l
      )));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  async function cancel(lesson: LessonView) {
    const ok = await confirmAction('Cancel this lesson? The balance will be restored.');
    if (!ok) return;
    setBusy(true);
    try {
      await api.post(`/api/teacher/lessons/${lesson.lesson_id}/cancel`);
      setEditing(null);
      notifySuccess('Lesson cancelled');
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      notifyError(message);
    } finally {
      setBusy(false);
    }
  }

  async function save(values: LessonEditValues) {
    if (!editing) return;
    setBusy(true);
    try {
      await api.patch(`/api/teacher/lessons/${editing.lesson_id}`, values);
      notifySuccess('Lesson saved');
      setEditing(null);
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      notifyError(message);
    } finally {
      setBusy(false);
    }
  }

  const pending = (lessons ?? []).filter((l) => l.state === 'pending_photo').length;

  return (
    <>
      <PageHeader title="My lessons" />
      <ErrorBox error={error} />
      <MonthPicker month={month} onChange={setMonth} />
      <PendingBanner count={pending} />
      {!lessons && !error && <SkeletonList rows={4} />}
      {lessons && groupByDay(lessons).map(([day, items]) => (
        <Section key={day} title={day}>
          {items.map((l) => {
            const editable = canChange(l);
            const timer = l.state === 'done' && l.edit_seconds_left > 0
              ? `edit ${Math.floor(l.edit_seconds_left / 60)}:${String(l.edit_seconds_left % 60).padStart(2, '0')}`
              : '';
            return (
              <Cell
                key={l.lesson_id}
                before={<LessonStateIcon state={l.state} />}
                title={l.student_name}
                subtitle={[`${l.duration_min} min`, lessonStateLabel(l.state), l.comment].filter(Boolean).join(' · ')}
                after={timer && <span className="badge num">{timer}</span>}
                chevron={editable}
                dimmed={l.state === 'cancelled'}
                onClick={editable ? () => setEditing(l) : undefined}
              />
            );
          })}
        </Section>
      ))}
      {cursor && <button className="btn plain" onClick={() => void loadMore()}>Load more</button>}
      {lessons && !lessons.length && (
        <EmptyState emoji="📅" title="No lessons this month" text="Open a student to mark a lesson." />
      )}

      <LessonEditSheet
        lesson={editing}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={(v) => void save(v)}
        onCancelLesson={() => editing && void cancel(editing)}
      />
    </>
  );
}
