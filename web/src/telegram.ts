type TelegramWebApp = {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; last_name?: string; username?: string } };
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  ready: () => void;
  expand: () => void;
  close: () => void;
  HapticFeedback?: { impactOccurred: (style: string) => void; notificationOccurred: (type: string) => void };
  showAlert?: (message: string, callback?: () => void) => void;
  showConfirm?: (message: string, callback?: (ok: boolean) => void) => void;
  BackButton: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
  MainButton: {
    setText: (text: string) => void;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
  };
};

export function tg(): TelegramWebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp: TelegramWebApp } }).Telegram?.WebApp;
}

export function initTelegram() {
  const app = tg();
  app?.ready();
  app?.expand();
}

export function getInitData(): string {
  return tg()?.initData ?? '';
}

export function closeApp() {
  tg()?.close();
}

export function haptic(kind: 'light' | 'success' | 'error' = 'light') {
  if (kind === 'light') tg()?.HapticFeedback?.impactOccurred('light');
  if (kind === 'success') tg()?.HapticFeedback?.notificationOccurred('success');
  if (kind === 'error') tg()?.HapticFeedback?.notificationOccurred('error');
}
