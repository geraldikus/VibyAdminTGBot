import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

// Fresh database per test file. Set before any app module is imported.
const dir = mkdtempSync(path.join(tmpdir(), 'school-admin-test-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.BACKUP_DIR = path.join(dir, 'backups');

afterAll(() => rmSync(dir, { recursive: true, force: true }));
