import { useEffect, useState } from 'react';
import type { Status } from '@school/shared';
import { STATUS_EMOJI, STATUS_LABEL } from '@school/shared';
import { registerFeedback } from './feedback';

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge ${status}`}>{STATUS_EMOJI[status]} {STATUS_LABEL[status]}</span>;
}

export function ErrorBox({ error }: { error?: string }) {
  if (!error) return null;
  return <div className="error">{error}</div>;
}

export function todayYmd() {
  const d = new Date();
  const tz = 3 * 60;
  const local = new Date(d.getTime() + (tz + d.getTimezoneOffset()) * 60000);
  return local.toISOString().slice(0, 10);
}

export function minDateYmd(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function FeedbackHost() {
  const [toast, setToast] = useState('');
  const [dialog, setDialog] = useState<{ message: string; resolve: (ok: boolean) => void } | null>(null);

  useEffect(() => {
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    const unregister = registerFeedback({
      toast: (message) => {
        setToast(message);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => setToast(''), 2500);
      },
      confirm: (message) => new Promise((resolve) => {
        setDialog({
          message,
          resolve: (ok) => {
            setDialog(null);
            resolve(ok);
          },
        });
      }),
    });
    return () => {
      clearTimeout(toastTimer);
      unregister();
    };
  }, []);

  return (
    <>
      {toast && <div className="toast">{toast}</div>}
      {dialog && (
        <div className="modal-backdrop" onClick={() => dialog.resolve(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p>{dialog.message}</p>
            <div className="btn-row">
              <button className="btn secondary" onClick={() => dialog.resolve(false)}>Cancel</button>
              <button className="btn" onClick={() => dialog.resolve(true)}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
