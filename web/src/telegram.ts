type MainButton = {
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

type TelegramWebApp = {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; last_name?: string; username?: string } };
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  version: string;
  ready: () => void;
  expand: () => void;
  close: () => void;
  isVersionAtLeast?: (version: string) => boolean;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  disableVerticalSwipes?: () => void;
  onEvent?: (event: string, cb: () => void) => void;
  HapticFeedback?: {
    impactOccurred: (style: string) => void;
    notificationOccurred: (type: string) => void;
    selectionChanged?: () => void;
  };
  showAlert?: (message: string, callback?: () => void) => void;
  showConfirm?: (message: string, callback?: (ok: boolean) => void) => void;
  BackButton: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
  MainButton: MainButton;
};

export function tg(): TelegramWebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp: TelegramWebApp } }).Telegram?.WebApp;
}

/** True only inside the Telegram client (the SDK script also loads in a plain browser). */
export function inTelegram(): boolean {
  return Boolean(tg()?.initData);
}

function atLeast(version: string): boolean {
  return Boolean(tg()?.isVersionAtLeast?.(version));
}

function applyTheme() {
  const app = tg();
  if (!app || !inTelegram()) return;
  document.documentElement.dataset.theme = app.colorScheme;
  if (atLeast('6.1')) {
    app.setHeaderColor?.('secondary_bg_color');
    app.setBackgroundColor?.('secondary_bg_color');
  }
  if (atLeast('7.10')) app.setBottomBarColor?.('secondary_bg_color');
}

export function initTelegram() {
  const app = tg();
  if (!app) return;
  app.ready();
  app.expand();
  if (!inTelegram()) return;
  applyTheme();
  app.onEvent?.('themeChanged', applyTheme);
  // Scrolling a long list should not swipe the Mini App closed.
  if (atLeast('7.7')) app.disableVerticalSwipes?.();
}

export function getInitData(): string {
  return tg()?.initData ?? '';
}

export function closeApp() {
  tg()?.close();
}

export function haptic(kind: 'light' | 'select' | 'success' | 'error' = 'light') {
  if (!inTelegram()) return;
  const h = tg()?.HapticFeedback;
  if (!h) return;
  if (kind === 'light') h.impactOccurred('light');
  if (kind === 'select') (h.selectionChanged ?? (() => h.impactOccurred('light')))();
  if (kind === 'success') h.notificationOccurred('success');
  if (kind === 'error') h.notificationOccurred('error');
}
