import cron from 'node-cron';
import { config } from './config.js';
import { todayYmd } from './time.js';
import { optimize } from './db/index.js';
import { processPhotoReminders } from './services/lessons.js';
import { catchUpBusinessReport, dailyBusinessReportJob } from './services/reports.js';
import { cleanupState } from './services/botState.js';
import { runBackup } from './services/backup.js';
import { mirrorEnabled, mirrorToSheets } from './services/sheetsMirror.js';

function job(name: string, fn: () => Promise<unknown> | unknown) {
  return async () => {
    try {
      await fn();
    } catch (error) {
      console.error(`${name} job failed`, error);
    }
  };
}

export function startScheduler() {
  cron.schedule('* * * * *', job('Photo reminder', processPhotoReminders));

  cron.schedule('0 9 * * *', job('Business report', dailyBusinessReportJob), { timezone: 'Europe/Moscow' });

  // Nightly: SQLite backup kept on the server, stale bot state cleanup, planner stats.
  // On the 1st of the month the backup is also sent to BACKUP_TELEGRAM_CHAT_ID.
  cron.schedule('30 3 * * *', job('Nightly maintenance', async () => {
    cleanupState();
    optimize();
    const firstOfMonth = todayYmd().endsWith('-01');
    await runBackup({ sendToTelegram: firstOfMonth });
  }), { timezone: 'Europe/Moscow' });

  if (mirrorEnabled()) {
    const every = Math.max(5, Math.min(config.mirrorEveryMin, 59));
    cron.schedule(`*/${every} * * * *`, job('Sheets mirror', mirrorToSheets));
    void job('Sheets mirror', mirrorToSheets)();
  }

  void job('Business report catch-up', catchUpBusinessReport)();
}
