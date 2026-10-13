import cron from 'node-cron';
import { processPhotoReminders } from './services/lessons.js';
import { catchUpBusinessReport, generateBusinessReport } from './services/reports.js';
import { previousMonth } from './time.js';

export function startScheduler() {
  cron.schedule('* * * * *', async () => {
    try {
      await processPhotoReminders();
    } catch (error) {
      console.error('Photo reminder job failed', error);
    }
  });

  cron.schedule('0 9 1 * *', async () => {
    try {
      await generateBusinessReport(previousMonth(), 'auto');
    } catch (error) {
      console.error('Business report job failed', error);
    }
  }, { timezone: 'Europe/Moscow' });

  void catchUpBusinessReport().catch((error) => {
    console.error('Business report catch-up failed', error);
  });
}
