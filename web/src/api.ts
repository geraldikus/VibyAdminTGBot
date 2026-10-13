import { getInitData } from './telegram';

const base = import.meta.env.VITE_API_URL ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  const initData = getInitData();
  if (initData) headers.set('X-Telegram-Init-Data', initData);
  if (!initData && import.meta.env.DEV) {
    const dev = localStorage.getItem('devUser') || 'admin:298752342';
    headers.set('X-Dev-User', dev);
  }
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed: ${res.status}`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
};
