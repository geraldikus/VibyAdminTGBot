import type { AppSettings, UpdateSettingsInput } from '@school/shared';
import { EDITABLE_SETTING_LIMITS, updateSettingsSchema } from '@school/shared';
import { tx } from '../db/index.js';
import { insertAudit, readSettings, readSettingsMap, setSetting } from '../db/rows.js';
import { nowIso } from '../time.js';

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

export const EDITABLE_SETTING_KEYS = Object.keys(EDITABLE_SETTING_LIMITS) as Array<keyof UpdateSettingsInput>;

/**
 * Changes admin-editable settings (Mini App and /set share this path and its validation).
 * Throws a ZodError on invalid input. Each changed value is written to the audit log.
 */
export function updateSettings(input: unknown, by: string): AppSettings {
  const changes = updateSettingsSchema.parse(input);
  return tx(() => {
    const current = readSettings();
    const now = nowIso();
    for (const key of EDITABLE_SETTING_KEYS) {
      const next = changes[key];
      if (next === undefined || next === current[key]) continue;
      setSetting(key, next);
      insertAudit({
        created_at: now,
        entity: 'settings',
        entity_id: key,
        field: key,
        old_value: String(current[key]),
        new_value: String(next),
        by,
      });
    }
    return readSettings();
  });
}
