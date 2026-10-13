import { repo } from './sheets/repo.js';

await repo.init();
console.log('Google Sheets bootstrap complete.');
process.exit(0);
