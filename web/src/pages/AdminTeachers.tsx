import { useEffect, useMemo, useState } from 'react';
import type { Teacher } from '@school/shared';
import { api } from '../api';
import { confirmAction, notifyError, notifySuccess } from '../feedback';
import { Avatar, Cell, EmptyState, ErrorBox, PageHeader, SearchInput, Section, SkeletonList } from '../ui';

export function AdminTeachers() {
  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  async function load() {
    const data = await api.get<{ teachers: Teacher[] }>('/api/admin/teachers');
    setTeachers(data.teachers);
  }

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase().replace(/^@/, '');
    const list = teachers ?? [];
    if (!query) return list;
    return list.filter((t) => [t.name, t.username, t.telegram_id].some((v) => v.toLowerCase().includes(query)));
  }, [teachers, q]);

  const pending = filtered.filter((t) => !t.active);
  const active = filtered.filter((t) => t.active);

  async function toggle(teacher: Teacher) {
    if (busyId) return;
    const ok = await confirmAction(teacher.active ? `Deactivate ${teacher.name}?` : `Approve ${teacher.name} as a teacher?`);
    if (!ok) return;
    setBusyId(teacher.teacher_id);
    try {
      if (!teacher.active) {
        await api.post(`/api/admin/teachers/${teacher.teacher_id}/approve`);
        notifySuccess(`${teacher.name} approved`);
      } else {
        await api.patch(`/api/admin/teachers/${teacher.teacher_id}`, { active: false });
        notifySuccess(`${teacher.name} deactivated`);
      }
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      notifyError(message);
    } finally {
      setBusyId('');
    }
  }

  const row = (t: Teacher) => (
    <Cell
      key={t.teacher_id}
      before={<Avatar name={t.name} seed={t.teacher_id} />}
      title={t.name}
      subtitle={[t.username && `@${t.username}`, `ID ${t.telegram_id}`].filter(Boolean).join(' · ')}
      after={
        <button
          className={`chip ${t.active ? '' : 'active'}`}
          disabled={!!busyId}
          onClick={(e) => { e.stopPropagation(); void toggle(t); }}
        >
          {busyId === t.teacher_id ? '…' : t.active ? 'Deactivate' : 'Approve'}
        </button>
      }
    />
  );

  return (
    <>
      <PageHeader title="Teachers" />
      <ErrorBox error={error} />
      {teachers && teachers.length > 5 && <SearchInput value={q} onChange={setQ} placeholder="Name, @username or ID" />}
      {!teachers && !error && <SkeletonList rows={3} />}
      {!!pending.length && <Section title={`Pending or inactive · ${pending.length}`}>{pending.map(row)}</Section>}
      {!!active.length && <Section title={`Active · ${active.length}`}>{active.map(row)}</Section>}
      {teachers && !teachers.length && (
        <EmptyState emoji="🧑‍🏫" title="No teachers yet" text="Teachers appear here after they send /start to the bot." />
      )}
      {teachers && !!teachers.length && !filtered.length && <EmptyState emoji="🔍" title="Nothing found" />}
    </>
  );
}
