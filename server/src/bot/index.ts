import { Bot, InlineKeyboard, webhookCallback } from 'grammy';
import type { FastifyInstance } from 'fastify';
import { config, isAdmin } from '../config.js';
import { approveTeacher, findTeacherByTelegramId, upsertPendingTeacher } from '../services/teachers.js';
import { setBotApi, setPhotoChannelId, notifyAdmins, notifyTeacher } from '../services/notify.js';
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

  bot.on('my_chat_member', async (ctx) => {
    const chat = ctx.chat;
    const status = ctx.myChatMember.new_chat_member.status;
    if ((chat.type === 'channel' || chat.type === 'supergroup') && (status === 'administrator' || status === 'member')) {
      const id = String(chat.id);
      setPhotoChannelId(id);
      await notifyAdmins(
        `Bot was added to ${chat.title ?? 'a chat'}.\nSet PHOTO_CHANNEL_ID=${id} in the environment (already used until restart).`,
      );
    }
  });

  bot.on('channel_post', async (ctx) => {
    if (ctx.chat.type === 'channel') {
      setPhotoChannelId(String(ctx.chat.id));
    }
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

export async function startBot(app: FastifyInstance, bot: ReturnType<typeof createBot>) {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Open the school app' },
    { command: 'id', description: 'Show your Telegram ID' },
  ]);

  try {
    await bot.api.setChatMenuButton({
      menu_button: { type: 'web_app', text: 'Open app', web_app: { url: config.webappUrl } },
    });
  } catch (error) {
    console.warn('Could not set menu button (WEBAPP_URL must be HTTPS in production):', error);
  }

  if (config.isProd && config.publicUrl) {
    const path = `/telegram/${config.webhookSecret}`;
    app.post(path, webhookCallback(bot, 'fastify'));
    await bot.api.setWebhook(`${config.publicUrl}${path}`);
    console.log(`Webhook set to ${config.publicUrl}${path}`);
    return;
  }

  await bot.api.deleteWebhook({ drop_pending_updates: false });
  void bot.start({
    onStart: () => console.log('Bot started with long polling'),
  });
}
