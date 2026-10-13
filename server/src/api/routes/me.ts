import type { FastifyInstance } from 'fastify';
import { getSettings } from '../../services/settings.js';

export async function registerMeRoutes(app: FastifyInstance) {
  app.get('/api/me', async (request) => {
    const settings = await getSettings();
    return { user: request.authUser, settings };
  });
}
