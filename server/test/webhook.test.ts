import Fastify from 'fastify';
import { Bot } from 'grammy';
import { describe, expect, it } from 'vitest';
import { registerWebhookRoute } from '../src/bot/index.js';

const SECRET = 's'.repeat(40);
const update = {
  update_id: 1,
  message: { message_id: 1, date: 0, chat: { id: 1, type: 'private' }, from: { id: 1, is_bot: false, first_name: 'A' }, text: 'hi' },
};

async function setup() {
  const bot = new Bot('123:test', {
    botInfo: {
      id: 1, is_bot: true, first_name: 'Test', username: 'test_bot', can_join_groups: false,
      can_read_all_group_messages: false, supports_inline_queries: false,
    } as never,
  });
  let handled = 0;
  bot.on('message', () => { handled++; });
  const app = Fastify();
  const path = registerWebhookRoute(app, bot, SECRET);
  return { app, path, handled: () => handled };
}

describe('Telegram webhook', () => {
  it('does not put the secret into the URL', async () => {
    const { path } = await setup();
    expect(path).toMatch(/^\/telegram\/[0-9a-f]{16}$/);
    expect(path).not.toContain(SECRET);
  });

  it('rejects updates without the secret header and accepts the right one', async () => {
    const { app, path, handled } = await setup();
    const none = await app.inject({ method: 'POST', url: path, payload: update });
    const wrong = await app.inject({ method: 'POST', url: path, payload: update, headers: { 'x-telegram-bot-api-secret-token': 'nope' } });
    const right = await app.inject({ method: 'POST', url: path, payload: update, headers: { 'x-telegram-bot-api-secret-token': SECRET } });

    expect(none.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(right.statusCode).toBe(200);
    expect(handled()).toBe(1);
  });
});
