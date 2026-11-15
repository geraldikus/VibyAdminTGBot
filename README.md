# English School TMA

Telegram-бот + Mini App для учёта уроков и абонементов языковой школы.
Данные хранятся в **SQLite** (`data/school.db`), фото уроков — в закрытом Telegram-канале.
Google Sheets используется только как **односторонняя копия только для чтения** (БД → таблица, опционально).

## Локальный запуск

```bash
cp .env.example .env      # заполнить BOT_TOKEN, ADMIN_IDS
npm install
npm run dev               # API + Vite, бот в режиме long polling
```

База создаётся сама в `data/school.db`. Без Telegram можно открыть `http://localhost:5173`:
в dev-режиме запросы идут с заголовком `X-Dev-User` (`admin:<id>` по умолчанию, меняется в `localStorage.devUser`,
например `teacher:TELEGRAM_ID:TEACHER_UUID`).

## Команды бота

- `/start` — открыть Mini App или отправить заявку учителя.
- `/id` — показать Telegram ID и chat ID.
- Только для админов, в личке с ботом:
  - `/settings` — текущие настройки.
  - `/set <key> <value>` — изменить `backdate_days`, `edit_window_min`, `photo_reminder_min`, `photo_admin_alert_min`.
  - `/setchannel -100…` — канал для фото уроков (бот должен быть в нём админом). Сам бот канал не переключает.

## Бэкапы

Каждую ночь в 03:30 по Москве делается онлайн-копия базы в `data/backups/school-YYYY-MM-DD.db.gz`
(остаётся на сервере, хранится `BACKUP_KEEP_DAYS` дней, по умолчанию 14).
**1-го числа каждого месяца** бэкап ещё и присылается в `BACKUP_TELEGRAM_CHAT_ID`: Excel-файл для просмотра
и `.db.gz` для восстановления. В любой момент Excel можно получить кнопкой «Download backup» на дашборде.
Вручную на сервере: `npm run backup -w server`.

Восстановление: остановить контейнер, `gunzip -c school-….db.gz > data/school.db`, удалить
`school.db-wal`/`school.db-shm`, запустить.

## Google Sheets (опционально)

- **Перенос данных из старой таблицы** (один раз):
  ```bash
  npm run migrate:sheets -- --dry-run   # только проверка и отчёт
  npm run migrate:sheets                # импорт в пустую БД (--force — затереть и импортировать заново)
  ```
  Скрипт сверяет балансы с `Balance_Log` и выводит расхождения.
- **Зеркало**: `SHEETS_MIRROR=1` + `SPREADSHEET_ID` + credentials. Каждые `SHEETS_MIRROR_EVERY_MIN` минут таблица
  **полностью перезаписывается** содержимым БД. Используйте для этого **новую** таблицу, а старую оставьте архивом.
  Правки в таблице ни на что не влияют.

## Деплой на Vultr (рядом с существующим ботом)

На сервере уже работает `atomic-english-bot` и Caddy. Их не трогаем, кроме добавления блока в Caddyfile.

| | Новый бот |
|---|---|
| Каталог | `/opt/school-admin` (`.env`, `docker-compose.yml`, `data/`) |
| Контейнер | `school-admin-bot`, образ `school-admin-bot:latest`, сеть `viby`, порт 3000 только внутри сети |
| Домен | `admin-viby-school.duckdns.org` → `209.250.251.138` |

### Первый запуск

1. **DNS.** В DuckDNS поставить `admin-viby-school` → `209.250.251.138`. Проверить:
   ```bash
   dig +short admin-viby-school.duckdns.org
   ```
   Должно быть `209.250.251.138`. Пока это не так, Caddy не трогать.
2. **Swap 2 GB** (рекомендуется, 1 GB RAM на двух ботов):
   ```bash
   fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   sysctl vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
   ```
3. **Каталог и .env** на сервере:
   ```bash
   mkdir -p /opt/school-admin/data && chown -R 1000:1000 /opt/school-admin/data
   nano /opt/school-admin/.env && chmod 600 /opt/school-admin/.env
   ```
   Минимум: `BOT_TOKEN`, `ADMIN_IDS`, `PHOTO_CHANNEL_ID`, `WEBAPP_URL=https://admin-viby-school.duckdns.org`,
   `PUBLIC_URL=https://admin-viby-school.duckdns.org`, `WEBHOOK_SECRET=$(openssl rand -hex 32)`, `BACKUP_TELEGRAM_CHAT_ID`.
4. **Перенос данных.** Остановить сервис на Render (иначе он вернёт свой вебхук и продолжит писать в таблицу).
   Локально:
   ```bash
   DB_PATH=./data/school.db npm run migrate:sheets
   ```
   Отправить базу на сервер:
   ```bash
   scp data/school.db root@209.250.251.138:/opt/school-admin/data/
   ```
   ```bash
   ssh root@209.250.251.138 'chown 1000:1000 /opt/school-admin/data/school.db'
   ```
5. **Образ и запуск** (собирается на Mac, сервер ничего не компилирует):
   ```bash
   deploy/deploy.sh
   ```
6. **Caddy.** Сделать бэкап и **дописать** блок из `deploy/Caddyfile.snippet` в конец `/opt/caddy/Caddyfile`, проверить
   конфиг и перезагрузить только Caddy:
   ```bash
   cp /opt/caddy/Caddyfile /opt/caddy/Caddyfile.bak-$(date +%F)
   ```
   ```bash
   docker exec <caddy-container> caddy validate --config /etc/caddy/Caddyfile
   ```
   ```bash
   docker exec <caddy-container> caddy reload --config /etc/caddy/Caddyfile
   ```
   Проверить оба сайта: `https://vibyschool.duckdns.org` и `https://admin-viby-school.duckdns.org/health`.
7. Перезапустить бота, чтобы он поставил вебхук уже на рабочий HTTPS:
   ```bash
   ssh root@209.250.251.138 'docker restart school-admin-bot'
   ```
   В BotFather обновить URL Mini App на `https://admin-viby-school.duckdns.org`.

### Обновления

```bash
deploy/deploy.sh
```

Скрипт собирает образ под `linux/amd64`, передаёт его по ssh, перезапускает только `school-admin-bot`, ждёт healthcheck
и удаляет старые образы `school-admin-bot` (другие образы не трогает).

### Ресурсы

Контейнер ограничен 256 MB RAM (`mem_limit`), Node — 192 MB heap, логи Docker — 3 файла по 10 MB.
База растёт примерно на 5–10 MB в год, удалять историю не нужно.
