import { createHash } from 'node:crypto';
import { Bot, InlineKeyboard, webhookCallback } from 'grammy';
import type { FastifyInstance } from 'fastify';
import { config, isAdmin } from '../config.js';
import { approveTeacher, findTeacherByTelegramId, upsertPendingTeacher } from '../services/teachers.js';
import {
  getPhotoChannelId,
  notifyAdmins,
  notifyTeacher,
  photoChannelFromEnv,
  setBotApi,
  setPhotoChannelId,
} from '../services/notify.js';
import { EDITABLE_SETTINGS, getSettings, writeSetting } from '../services/settings.js';
import { handleIncomingPhoto, handlePhotoChoice, setAwaitingPhotoReplace } from './photo.js';

export function createBot() {
  if (!config.botToken) {
    throw new Error('BOT_TOKEN is required to start the bot');
  }
  const bot = new Bot(config.botToken);
  setBotApi(bot.api);

  bot.command('start', async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const name = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
    const open = new InlineKeyboard().webApp('Open Mini App', config.webappUrl);

    if (isAdmin(from.id)) {
      await ctx.reply('Welcome, admin. Open the Mini App to manage students, lessons and reports.', {
        reply_markup: open,
      });
      return;
    }

    const teacher = await findTeacherByTelegramId(String(from.id));
    if (teacher?.active) {
      await ctx.reply('Welcome. Open the Mini App to view your students and mark lessons.', {
        reply_markup: open,
      });
      return;
    }

    const { teacher: pending, created } = await upsertPendingTeacher({
      telegramId: String(from.id),
      name: name || `Teacher ${from.id}`,
      username: from.username ?? '',
    });
    await ctx.reply('Access pending. An admin will review your request.');
    if (created) {
      const keyboard = new InlineKeyboard().text('Approve as teacher', `approve:${pending.teacher_id}`);
      await notifyAdmins(
        `New access request\n${name || from.id}${from.username ? ` (@${from.username})` : ''}\nTelegram ID: ${from.id}`,
      );
      for (const adminId of config.adminIds) {
        try {
          await bot.api.sendMessage(adminId, 'Approve this teacher?', { reply_markup: keyboard });
        } catch (error) {
          console.error(error);
        }
      }
    }
  });

  bot.command('id', async (ctx) => {
    await ctx.reply(`Your Telegram ID: ${ctx.from?.id}\nChat ID: ${ctx.chat.id}`);
  });

  // The photo channel is never switched automatically: the bot only reports the chat ID,
  // an admin has to confirm it with /setchannel.
  bot.on('my_chat_member', async (ctx) => {
    const chat = ctx.chat;
    const status = ctx.myChatMember.new_chat_member.status;
    if ((chat.type === 'channel' || chat.type === 'supergroup') && (status === 'administrator' || status === 'member')) {
      await notifyAdmins(
        `Bot was added to ${chat.title ?? 'a chat'} (ID ${chat.id}).\n`
          + `To use it for lesson photos send: /setchannel ${chat.id}`,
      );
    }
  });

  bot.command('setchannel', async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id) || ctx.chat.type !== 'private') return;
    const id = ctx.match.trim();
    if (!/^-100\d{5,}$/.test(id)) {
      await ctx.reply(`Usage: /setchannel -100XXXXXXXXXX\nCurrent: ${getPhotoChannelId() || 'not set'}`);
      return;
    }
    if (photoChannelFromEnv()) {
      await ctx.reply('PHOTO_CHANNEL_ID is set in .env and takes priority. Change it there and restart.');
      return;
    }
    try {
      const me = await ctx.api.getChatMember(id, ctx.me.id);
      if (me.status !== 'administrator') {
        await ctx.reply('The bot must be an administrator of that channel.');
        return;
      }
    } catch {
      await ctx.reply('The bot has no access to that chat.');
      return;
    }
    await setPhotoChannelId(id);
    await ctx.reply(`Lesson photos will be posted to ${id}.`);
  });

  bot.command('settings', async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id) || ctx.chat.type !== 'private') return;
    const settings = await getSettings();
    const lines = Object.entries(settings).map(([k, v]) => `${k} = ${v}`);
    await ctx.reply(
      `${lines.join('\n')}\nphoto_channel_id = ${getPhotoChannelId() || '-'}\n\n`
        + `Change: /set <key> <value>\nKeys: ${Object.keys(EDITABLE_SETTINGS).join(', ')}`,
    );
  });

  bot.command('set', async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id) || ctx.chat.type !== 'private') return;
    const [key, value] = ctx.match.trim().split(/\s+/, 2);
    const validate = key ? EDITABLE_SETTINGS[key] : undefined;
    if (!validate || value === undefined || !validate(value)) {
      await ctx.reply(`Usage: /set <key> <value>\nKeys: ${Object.keys(EDITABLE_SETTINGS).join(', ')}`);
      return;
    }
    await writeSetting(key, value);
    await ctx.reply(`${key} = ${value}`);
  });

  bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: 'Admins only', show_alert: true });
      return;
    }
    const teacherId = ctx.match![1];
    const teacher = await approveTeacher(teacherId, ctx.from.first_name);
    await ctx.answerCallbackQuery({ text: 'Approved' });
    await ctx.editMessageText(`Approved: ${teacher.name}`);
    if (teacher.telegram_id) {
      await notifyTeacher(teacher.telegram_id, 'You have been approved as a teacher. Open the Mini App to start.');
    }
  });

  bot.callbackQuery(/^photo:([^:]+):(.+)$/, async (ctx) => {
    await handlePhotoChoice(ctx, ctx.match![1], ctx.match![2]);
  });

  bot.callbackQuery(/^replace_photo:(.+)$/, async (ctx) => {
    const lessonId = ctx.match![1];
    setAwaitingPhotoReplace(String(ctx.from?.id), lessonId);
    await ctx.answerCallbackQuery();
    await ctx.reply('Send a new photo for this lesson.');
  });

  bot.on(['message:photo', 'message:document'], handleIncomingPhoto);

  bot.catch((err) => {
    console.error('Bot error', err);
  });

  return bot;
}

/**
 * Telegram sends the secret in the X-Telegram-Bot-Api-Secret-Token header;
 * grammY rejects requests without it (401). The path itself is not secret.
 */
export function registerWebhookRoute(app: FastifyInstance, bot: Bot, secret: string): string {
  const path = `/telegram/${createHash('sha256').update(secret).digest('hex').slice(0, 16)}`;
  app.post(path, webhookCallback(bot, 'fastify', { secretToken: secret }));
  return path;
}

export async function startBot(app: FastifyInstance, bot: ReturnType<typeof createBot>) {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Open the school app' },
    { command: 'id', description: 'Show your Telegram ID' },
  ]);
  for (const adminId of config.adminIds) {
    try {
      await bot.api.setMyCommands([
        { command: 'start', description: 'Open the school app' },
        { command: 'settings', description: 'Show settings' },
        { command: 'set', description: 'Change a setting' },
        { command: 'setchannel', description: 'Set the lesson photo channel' },
        { command: 'id', description: 'Show your Telegram ID' },
      ], { scope: { type: 'chat', chat_id: Number(adminId) } });
    } catch (error) {
      console.warn('Could not set admin commands for', adminId);
    }
  }

  try {
    await bot.api.setChatMenuButton({
      menu_button: { type: 'web_app', text: 'Open app', web_app: { url: config.webappUrl } },
    });
  } catch (error) {
    console.warn('Could not set menu button (WEBAPP_URL must be HTTPS in production):', error);
  }

  if (config.isProd && config.publicUrl) {
    const path = registerWebhookRoute(app, bot, config.webhookSecret);
    await bot.api.setWebhook(`${config.publicUrl}${path}`, {
      secret_token: config.webhookSecret,
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
    });
    console.log('Webhook set');
    return;
  }

  await bot.api.deleteWebhook({ drop_pending_updates: false });
  void bot.start({
    onStart: () => console.log('Bot started with long polling'),
  });
}
