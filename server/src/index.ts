import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { assertProdConfig, config } from './config.js';
import { db } from './db/index.js';
import { authMiddleware } from './api/auth.js';
import { registerMeRoutes } from './api/routes/me.js';
import { registerTeacherRoutes } from './api/routes/teacher.js';
import { registerAdminRoutes } from './api/routes/admin.js';
import { createBot, startBot } from './bot/index.js';
import { startScheduler } from './scheduler.js';
import { loadPhotoChannelId } from './services/notify.js';

async function main() {
  assertProdConfig();
  console.log(`DB ready: ${config.dbPath}`);
  await loadPhotoChannelId();

  // In production only warnings/errors are logged (request logs are 'info').
  const app = Fastify({ logger: { level: config.isProd ? 'warn' : 'info' } });
  await app.register(cors, { origin: true });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Validation error', details: error.flatten() });
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : 'Internal error';
    requestLog(error);
    return reply.code(status).send({ error: message });
  });

  app.get('/health', async () => ({ ok: true }));

  app.register(async (api) => {
    api.addHook('preHandler', authMiddleware);
    await registerMeRoutes(api);
    await registerTeacherRoutes(api);
    await registerAdminRoutes(api);
  });

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

function requestLog(error: unknown) {
  console.error(error);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
