import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { AppSettings, AuthUser } from '@school/shared';
import { api } from './api';
import { TeacherStudents } from './pages/TeacherStudents';
import { TeacherStudent } from './pages/TeacherStudent';
import { TeacherLessons } from './pages/TeacherLessons';
import { AdminDashboard } from './pages/AdminDashboard';
import { AdminStudents } from './pages/AdminStudents';
import { AdminStudent } from './pages/AdminStudent';
import { AdminTeachers } from './pages/AdminTeachers';
import { AdminLessons } from './pages/AdminLessons';
import { AdminReports } from './pages/AdminReports';
import { AdminSettings } from './pages/AdminSettings';
import { FeedbackHost, Icon, SkeletonList, useBackButton, type IconName } from './ui';

type Tab = { to: string; label: string; icon: IconName; end?: boolean };

const ADMIN_TABS: Tab[] = [
  { to: '/admin', label: 'Home', icon: 'home', end: true },
  { to: '/admin/students', label: 'Students', icon: 'students' },
  { to: '/admin/lessons', label: 'Lessons', icon: 'lessons' },
  { to: '/admin/teachers', label: 'Teachers', icon: 'teachers' },
  { to: '/admin/reports', label: 'Reports', icon: 'reports' },
];

const TEACHER_TABS: Tab[] = [
  { to: '/', label: 'Students', icon: 'students', end: true },
  { to: '/lessons', label: 'Lessons', icon: 'lessons' },
];

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    api.get<{ user: AuthUser; settings: AppSettings }>('/api/me')
      .then((data) => {
        setUser(data.user);
        setSettings(data.settings);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const nested = location.pathname.split('/').filter(Boolean).length > 1
    || /\/(students|lessons|teachers|reports)\//.test(location.pathname);
  useBackButton(() => navigate(-1), nested);

  if (error) {
    return (
      <div className="app">
        <div className="error">{error}</div>
        <p className="muted">Open this Mini App from the Telegram bot. If you are developing locally, set a X-Dev-User header via localStorage.devUser.</p>
      </div>
    );
  }
  if (!user || !settings) {
    return (
      <div className="app no-nav">
        <div className="header"><div className="skeleton" style={{ width: 160, height: 28 }} /></div>
        <SkeletonList rows={6} />
      </div>
    );
  }

  const isAdmin = user.role === 'admin';

  return (
    <div className="app">
      <Routes>
        {isAdmin ? (
          <>
            <Route path="/" element={<Navigate to="/admin" replace />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/students" element={<AdminStudents />} />
            <Route path="/admin/students/:id" element={<AdminStudent />} />
            <Route path="/admin/teachers" element={<AdminTeachers />} />
            <Route path="/admin/lessons" element={<AdminLessons />} />
            <Route path="/admin/reports" element={<AdminReports />} />
            <Route path="/admin/settings" element={<AdminSettings onSaved={setSettings} />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </>
        ) : (
          <>
            <Route path="/" element={<TeacherStudents />} />
            <Route path="/students/:id" element={<TeacherStudent settings={settings} />} />
            <Route path="/lessons" element={<TeacherLessons />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
      <FeedbackHost />
      <nav className="nav">
        <div className="nav-inner">
          {(isAdmin ? ADMIN_TABS : TEACHER_TABS).map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.end}>
              <Icon name={tab.icon} size={25} strokeWidth={1.8} />
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
