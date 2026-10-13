# English School TMA

Telegram-бот + Mini App для учёта уроков и абонементов языковой школы. Данные хранятся в Google Sheets, фото уроков — в закрытом Telegram-канале.

## Локальный запуск

1. Скопируйте `.env.example` в `.env` и заполните `BOT_TOKEN`.
2. Положите `credentials.json` сервисного аккаунта в корень (файл уже в `.gitignore`).
3. Расшарьте таблицу на email сервисного аккаунта с правом Editor.
4. Добавьте бота админом в закрытый канал для фото.
5. Установите зависимости и создайте листы:

```bash
npm install
npm run bootstrap
```

6. Запуск API + Vite:

```bash
npm run dev
```

Mini App в Telegram требует HTTPS. Для проверки UI локально:

```bash
cloudflared tunnel --url http://localhost:5173
```

Полученный `https://…` укажите в BotFather (`/setmenubutton` / Menu Button) и в `WEBAPP_URL`.

Без Telegram можно открыть `http://localhost:5173` в браузере: в dev-режиме запросы идут с заголовком `X-Dev-User` (`admin:298752342` по умолчанию, можно поменять в `localStorage.devUser`, например `teacher:TELEGRAM_ID:TEACHER_UUID`).

## Деплой на Render

1. Создайте **Web Service** (план Starter, чтобы процесс не засыпал).
2. Root Directory — корень репозитория.
3. Build: `npm install && npm run build`
4. Start: `npm start`
5. Instance count: **1**.
6. Переменные окружения:

| Переменная | Значение |
|---|---|
| `NODE_ENV` | `production` |
| `BOT_TOKEN` | токен от BotFather |
| `ADMIN_IDS` | `298752342` |
| `SPREADSHEET_ID` | `1lQLDAsgHifYRLbfY5qiJE4s7H-MgkpyD7R1TjpcNPM0` |
| `GOOGLE_CREDENTIALS_JSON` | содержимое `credentials.json` одной строкой |
| `PHOTO_CHANNEL_ID` | `-100…` (бот пришлёт ID после добавления в канал) |
| `WEBAPP_URL` | `https://<ваш-сервис>.onrender.com` |
| `PUBLIC_URL` | тот же URL |
| `WEBHOOK_SECRET` | случайная строка |

7. В BotFather: Menu Button / Domain = URL сервиса.

После деплоя бот ставит webhook на `https://<сервис>/telegram/<WEBHOOK_SECRET>`.

## Полезные команды бота

- `/start` — открыть Mini App или отправить заявку учителя.
- `/id` — показать Telegram ID и chat ID.
