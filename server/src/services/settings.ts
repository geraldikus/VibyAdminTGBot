import type { AppSettings } from '@school/shared';
import { readSettings, readSettingsMap, setSetting } from '../db/rows.js';

export async function getSettings(): Promise<AppSettings> {
  return readSettings();
}

export function getSettingsSync(): AppSettings {
  return readSettings();
}

export function getRawSetting(key: string): string | undefined {
  return readSettingsMap().get(key);
}

export async function writeSetting(key: string, value: string | number) {
  setSetting(key, value);
}

/** Settings an admin may change from the bot with /set. */
export const EDITABLE_SETTINGS: Record<string, (v: string) => boolean> = {
  backdate_days: (v) => /^\d{1,3}$/.test(v),
  edit_window_min: (v) => /^\d{1,5}$/.test(v),
  photo_reminder_min: (v) => /^\d{1,4}$/.test(v) && Number(v) >= 1,
  photo_admin_alert_min: (v) => /^\d{1,5}$/.test(v) && Number(v) >= 1,
};
