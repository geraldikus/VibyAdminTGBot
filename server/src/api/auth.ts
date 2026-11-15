import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '@school/shared';
import { config, isAdmin } from '../config.js';
import { findTeacherByTelegramId } from '../services/teachers.js';

const MAX_AGE_SEC = 86_400;

export function validateInitData(initData: string): {
  telegramId: string;
  name: string;
  username: string;
} {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw Object.assign(new Error('Missing initData hash'), { statusCode: 401 });

  const entries = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const computed = createHmac('sha256', secret).update(entries).digest('hex');
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw Object.assign(new Error('Invalid initData'), { statusCode: 401 });
  }

  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SEC) {
    throw Object.assign(new Error('initData expired'), { statusCode: 401 });
  }

  const userRaw = params.get('user');
  if (!userRaw) throw Object.assign(new Error('Missing user in initData'), { statusCode: 401 });
  const user = JSON.parse(userRaw) as {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return {
    telegramId: String(user.id),
    name: name || String(user.id),
    username: user.username ?? '',
  };
}

export async function resolveUser(initData: string): Promise<AuthUser> {
  const identity = validateInitData(initData);
  if (isAdmin(identity.telegramId)) {
    return { ...identity, role: 'admin' };
  }
  const teacher = await findTeacherByTelegramId(identity.telegramId);
  if (teacher?.active) {
    return { ...identity, role: 'teacher', teacherId: teacher.teacher_id };
  }
  throw Object.assign(new Error('Access denied'), { statusCode: 403 });
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser;
  }
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers['x-telegram-init-data']
    ?? (typeof request.headers.authorization === 'string' && request.headers.authorization.startsWith('tma ')
      ? request.headers.authorization.slice(4)
      : '');
  const initData = String(header || '');
  if (!initData) {
    if (!config.isProd && request.headers['x-dev-user']) {
      const [role, telegramId, teacherId] = String(request.headers['x-dev-user']).split(':');
      request.authUser = {
        telegramId: telegramId || config.adminIds[0],
        name: 'Dev User',
        username: 'dev',
        role: role === 'teacher' ? 'teacher' : 'admin',
        teacherId: teacherId || undefined,
      };
      return;
    }
    return reply.code(401).send({ error: 'Missing Telegram initData' });
  }
  try {
    request.authUser = await resolveUser(initData);
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode ?? 401;
    return reply.code(status).send({ error: error instanceof Error ? error.message : 'Unauthorized' });
  }
}

export function requireRole(...roles: AuthUser['role'][]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(request.authUser.role)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  };
}

export function hashTokenHint(): string {
  return createHash('sha256').update(config.botToken).digest('hex').slice(0, 8);
}
