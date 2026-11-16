# Operations guide

How to run, deploy and maintain the bot. For what the project is and why it is built this way, see the [README](../README.md).

## Configuration

All settings come from environment variables. See [`.env.example`](../.env.example) for the full list.

| Variable | Purpose |
|---|---|
| `BOT_TOKEN` | Telegram bot token from BotFather |
| `ADMIN_IDS` | Comma-separated Telegram IDs of admins (required in production) |
| `WEBAPP_URL`, `PUBLIC_URL` | Public HTTPS URL of the service (Mini App and webhook) |
| `WEBHOOK_SECRET` | 32+ random characters, sent by Telegram in the `X-Telegram-Bot-Api-Secret-Token` header |
| `PHOTO_CHANNEL_ID` | Private channel for lesson photos (can also be set with `/setchannel`) |
| `DB_PATH` | SQLite file, default `./data/school.db` |
| `BACKUP_TELEGRAM_CHAT_ID` | Chat that receives the monthly backup |
| `SHEETS_MIRROR`, `SPREADSHEET_ID` | Optional read-only Google Sheets mirror |

## Local development

```bash
cp .env.example .env      # set BOT_TOKEN and ADMIN_IDS
npm install
npm run dev               # API + Vite; the bot uses long polling
```

Without Telegram, open `http://localhost:5173`. In development the API accepts an `X-Dev-User` header instead of
Telegram `initData` (`admin:1` by default; change it with `localStorage.devUser = "teacher:<telegram_id>:<teacher_id>"`).

Demo data without a bot token:

```bash
npm run seed:demo -- --force
```

```bash
npm run demo
```

Checks:

```bash
npm run build   # type-check, Mini App build, server bundle
```

```bash
npm test        # Vitest suite (server/test)
```

## Bot commands

- `/start` — open the Mini App, or send a teacher access request.
- `/id` — show your Telegram ID and the chat ID.
- Admins only, in a private chat with the bot:
  - `/settings` — current settings.
  - `/set <key> <value>` — change `backdate_days`, `edit_window_min`, `photo_reminder_min`, `photo_admin_alert_min`.
  - `/setchannel -100…` — set the lesson photo channel (the bot must be an admin there). The bot never switches the channel by itself.

## Backups

- Every night at 03:30 (Europe/Moscow) an online SQLite backup is written to `data/backups/school-YYYY-MM-DD.db.gz`
  and kept for `BACKUP_KEEP_DAYS` days (default 14).
- On the 1st of every month the backup is also sent to `BACKUP_TELEGRAM_CHAT_ID`: an Excel file to read
  and the `.db.gz` file to restore.
- Admins can get the Excel file at any time with **Download backup** on the dashboard.

Manual backup on the server:

```bash
docker exec school-admin-bot node server/dist/backup-cli.js
```

Restore: stop the container, `gunzip -c school-….db.gz > data/school.db`, delete `school.db-wal` and `school.db-shm`, start the container.

## Google Sheets (optional)

**One-time import** from the old spreadsheet:

```bash
npm run migrate:sheets -- --dry-run   # read, validate and report, writes nothing
```

```bash
npm run migrate:sheets                # import into an empty database (--force to wipe and re-import)
```

The script normalises dates regardless of the sheet locale, merges duplicate teachers, skips orphan rows,
and checks that every balance equals the sum of its balance log.

**Mirror**: with `SHEETS_MIRROR=1`, `SPREADSHEET_ID` and service-account credentials, the whole database is written
to the spreadsheet every `SHEETS_MIRROR_EVERY_MIN` minutes. The mirror **overwrites** the spreadsheet, so use a new one.
The bot never reads it back.

## Deployment (Docker on a small VPS)

The service runs next to other containers behind an existing Caddy reverse proxy and does not publish ports itself.

| | |
|---|---|
| Directory | `/opt/school-admin` (`.env`, `docker-compose.yml`, `data/`) |
| Container | `school-admin-bot`, image `school-admin-bot:latest`, shared Docker network, port 3000 internal only |
| Domain | `admin.example.com` → `<server-ip>` |

### First run

1. **DNS**: point `admin.example.com` to `<server-ip>` and check it before touching Caddy:
   ```bash
   dig +short admin.example.com
   ```
2. **Directory and secrets** on the server:
   ```bash
   mkdir -p /opt/school-admin/data && chown -R 1000:1000 /opt/school-admin/data
   ```
   Create `/opt/school-admin/.env` (mode 600) with at least `BOT_TOKEN`, `ADMIN_IDS`, `WEBAPP_URL`, `PUBLIC_URL`,
   `WEBHOOK_SECRET` (`openssl rand -hex 32`) and `BACKUP_TELEGRAM_CHAT_ID`.
3. **Data**: import from Google Sheets locally and copy `data/school.db` to `/opt/school-admin/data/` (owner 1000:1000).
4. **Build and start**. The image is built on the developer machine, the server compiles nothing:
   ```bash
   echo 'DEPLOY_HOST=root@<server-ip>' > deploy/local.env
   ```
   ```bash
   deploy/deploy.sh
   ```
5. **Caddy**: back up the Caddyfile, append [`deploy/Caddyfile.snippet`](../deploy/Caddyfile.snippet), validate and reload
   (no container restart):
   ```bash
   docker exec <caddy-container> caddy validate --config /etc/caddy/Caddyfile
   ```
   ```bash
   docker exec <caddy-container> caddy reload --config /etc/caddy/Caddyfile
   ```
6. Restart the bot so it registers the webhook on the working HTTPS URL, then set the Mini App URL in BotFather.

### Updates

```bash
deploy/deploy.sh
```

Builds a `linux/amd64` image, streams it over SSH, restarts only `school-admin-bot`, waits for the healthcheck and
removes old `school-admin-bot` images (other images are untouched).

### Resources

- The server is compiled to plain JavaScript at build time ([`server/build.mjs`](../server/build.mjs)), so the container runs a single `node` process.
- Limits: 256 MB RAM, 192 MB V8 heap, Docker logs 3 × 10 MB. Typical usage is about 90 MB.
- The database grows by roughly 5–10 MB per year; no history needs to be deleted.
