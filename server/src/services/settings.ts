import type { AppSettings } from '@school/shared';
import { repo } from '../sheets/repo.js';
import { mapSettings } from '../sheets/mappers.js';

export async function getSettings(): Promise<AppSettings> {
  const rows = await repo.getAll('Settings');
  return mapSettings(rows);
}

export async function writeSetting(key: string, value: string | number) {
  await repo.write(async () => {
    await repo.updateSettingsKey(key, value);
  });
}
