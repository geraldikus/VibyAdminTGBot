import { useEffect, useState } from 'react';
import type { Teacher } from '@school/shared';
import { api } from '../api';
import { ErrorBox } from '../ui';

export function AdminTeachers() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [error, setError] = useState('');

  async function load() {
    const data = await api.get<{ teachers: Teacher[] }>('/api/admin/teachers');
    setTeachers(data.teachers);
  }

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  async function toggle(teacher: Teacher) {
    if (!teacher.active) {
      await api.post(`/api/admin/teachers/${teacher.teacher_id}/approve`);
    } else {
      await api.patch(`/api/admin/teachers/${teacher.teacher_id}`, { active: false });
    }
    await load();
  }

  return (
    <>
      <div className="header"><h1>Teachers</h1></div>
      <ErrorBox error={error} />
      {teachers.map((t) => (
        <div key={t.teacher_id} className="card">
          <div className="row">
            <div>
              <div className="title">{t.name}</div>
              <div className="small">{t.username ? `@${t.username}` : ''} · ID {t.telegram_id}</div>
            </div>
            <span className={`badge ${t.active ? 'green' : 'warn'}`}>{t.active ? 'Active' : 'Pending'}</span>
          </div>
          <div style={{ height: 8 }} />
          <button className={t.active ? 'btn secondary' : 'btn'} onClick={() => void toggle(t)}>
            {t.active ? 'Deactivate' : 'Approve'}
          </button>
        </div>
      ))}
      {!teachers.length && <p className="muted">No teachers yet. They appear after /start in the bot.</p>}
    </>
  );
}
