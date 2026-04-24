# Лакшми — Railway-ready проект

Это готовая версия проекта для Railway.

Что уже внутри:
- главная страница с рабочей заявкой;
- геймифицированная страница;
- админ-панель;
- сохранение заявок в SQLite;
- отправка уведомлений в Telegram и по SMTP;
- поддержка Railway Volume через `RAILWAY_VOLUME_MOUNT_PATH`.

## Локальный запуск

```bash
npm install
copy .env.example .env
npm start
```

Сайт: `http://localhost:3000`

Админка: `http://localhost:3000/admin/login`

## Что загрузить на GitHub

В репозиторий добавьте весь проект, кроме `node_modules` и `.env`.

## Что сделать на Railway

1. Создать новый проект.
2. Подключить GitHub-репозиторий с этим проектом.
3. Дождаться первого деплоя.
4. В Settings → Networking нажать **Generate Domain**.
5. В Settings → Volumes добавить Volume.
6. В качестве Mount Path можно указать `/data`.
7. В Variables добавить значения из `.env.example`.
8. В `SITE_URL` указать ваш адрес вида `https://<name>.up.railway.app`.
9. После изменения переменных выполнить redeploy.

## Почему нужен Volume

Без Volume SQLite-файл может не сохраняться между деплоями и перезапусками.

## Маршруты

- Главная: `/`
- Геймифицированная заявка: `/lakshmi_gamified_application_restyled.html`
- Админка: `/admin/login`
- Проверка сервиса: `/health`
