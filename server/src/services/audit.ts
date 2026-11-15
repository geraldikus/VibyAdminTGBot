import { nowIso } from '../time.js';
import { insertAudit } from '../db/rows.js';

/** Synchronous so it can run inside a transaction. */
export function writeAudit(entry: {
  entity: string;
  entity_id: string;
  field: string;
  old_value: string;
  new_value: string;
  by: string;
}) {
  insertAudit({ created_at: nowIso(), ...entry });
}
