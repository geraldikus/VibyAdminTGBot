import { runBackup } from './services/backup.js';

const file = await runBackup();
console.log(`Backup written: ${file}`);
process.exit(0);
