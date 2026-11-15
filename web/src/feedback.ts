import { haptic, inTelegram, tg } from './telegram';

type ToastFn = (message: string) => void;
type ConfirmFn = (message: string) => Promise<boolean>;

let toastFn: ToastFn | null = null;
let confirmFn: ConfirmFn | null = null;

export function registerFeedback(next: { toast: ToastFn; confirm: ConfirmFn }) {
  toastFn = next.toast;
  confirmFn = next.confirm;
  return () => {
    toastFn = null;
    confirmFn = null;
  };
}

/** Success: haptic + a short toast that does not block the screen. */
export function notifySuccess(message: string) {
  haptic('success');
  toastFn?.(message);
}

/** Errors need attention: native alert inside Telegram, toast elsewhere. */
export function notifyError(message: string) {
  haptic('error');
  const app = tg();
  if (inTelegram() && app?.showAlert) {
    app.showAlert(message);
    return;
  }
  toastFn?.(message);
}

export function confirmAction(message: string): Promise<boolean> {
  const app = tg();
  if (inTelegram() && app?.showConfirm) {
    return new Promise((resolve) => {
      app.showConfirm!(message, (ok) => resolve(Boolean(ok)));
    });
  }
  if (confirmFn) return confirmFn(message);
  return Promise.resolve(window.confirm(message));
}
