import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Each test file runs in its own process with its own fresh SQLite file (see test/setup.ts).
    pool: 'forks',
    setupFiles: ['test/setup.ts'],
    env: {
      NODE_ENV: 'test',
      BOT_TOKEN: '',
      ADMIN_IDS: '1',
      WEBAPP_URL: 'https://example.test',
      PUBLIC_URL: '',
      SPREADSHEET_ID: '',
      PHOTO_CHANNEL_ID: '',
      BACKUP_TELEGRAM_CHAT_ID: '',
    },
  },
});
