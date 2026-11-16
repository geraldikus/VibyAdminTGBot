import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { authMiddleware } from './api/auth.js';
import { registerMeRoutes } from './api/routes/me.js';
import { registerTeacherRoutes } from './api/routes/teacher.js';
import { registerAdminRoutes } from './api/routes/admin.js';

/** HTTP API without static files, bot or scheduler. Used by index.ts and the tests. */
export async function buildApi(opts: { logLevel?: string | false } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logLevel ? { level: opts.logLevel } : false });
  await app.register(cors, { origin: true });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Validation error', details: error.flatten() });
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : 'Internal error';
    if (status >= 500) console.error(error);
    return reply.code(status).send({ error: message });
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(async (api) => {
    api.addHook('preHandler', authMiddleware);
    await registerMeRoutes(api);
    await registerTeacherRoutes(api);
    await registerAdminRoutes(api);
  });

  return app;
}
