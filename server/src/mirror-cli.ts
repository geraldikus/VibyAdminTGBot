import { mirrorEnabled, mirrorToSheets } from './services/sheetsMirror.js';

if (!mirrorEnabled()) {
  console.error('Mirror disabled: set SHEETS_MIRROR=1, SPREADSHEET_ID and Google credentials.');
  process.exit(1);
}
console.log(await mirrorToSheets());
process.exit(0);
