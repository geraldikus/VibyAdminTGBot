import { nowIso } from '../time.js';
import { repo } from '../sheets/repo.js';

export async function writeAudit(entry: {
  entity: string;
  entity_id: string;
  field: string;
  old_value: string;
  new_value: string;
  by: string;
}) {
  await repo.appendRows('Audit_Log', [{ created_at: nowIso(), ...entry }]);
}
