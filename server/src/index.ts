import path from 'node:path';
import fs from 'node:fs';
import fastifyStatic from '@fastify/static';
import { assertProdConfig, config } from './config.js';
import { db } from './db/index.js';
import { buildApi } from './app.js';
import { createBot, startBot } from './bot/index.js';
import { startScheduler } from './scheduler.js';
import { loadPhotoChannelId } from './services/notify.js';

async function main() {
  assertProdConfig();
  console.log(`DB ready: ${config.dbPath}`);
  await loadPhotoChannelId();

  // In production only warnings/errors are logged (request logs are 'info').
  const app = await buildApi({ logLevel: config.isProd ? 'warn' : 'info' });

  const webDist = path.join(config.rootDir, 'web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/telegram')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  if (config.botToken) {
    const bot = createBot();
    await startBot(app, bot);
  } else {
    console.warn('BOT_TOKEN is empty — API and Sheets are up, bot is disabled');
  }

  startScheduler();

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`Server listening on ${config.port}`);

  const shutdown = async () => {
    await app.close().catch(() => undefined);
    db.close();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
