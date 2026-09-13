# kanata · Cloudflare + AWS

Личный сайт музыканта и закрытая статистика. Фронтенд раздаётся из Cloudflare Workers Static Assets, API и данные остаются в действующем AWS-бэкенде.

**Начни с [START-HERE.md](START-HERE.md): готовая инструкция по кнопкам для GitHub, Cloudflare и AWS.**

- [Архитектура и границы проверки](docs/ARCHITECTURE.md)
- [Отключение старых расходов](docs/AWS-CLEANUP.md)
- [Проверки переноса](docs/VERIFICATION.md)

## Локальная работа

Нужен Node.js 24.

```bash
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:browser
npm run dev
```

Открой http://127.0.0.1:8787. Локальная страница не отправляет аналитику. Для настоящего входа используй настроенный preview-домен; тесты браузера используют отдельные фиктивные ответы API и никогда не пишут в AWS.

## Публикация

`wrangler.preview.jsonc` подключает preview.kanata27.com к kanata-web-preview. `wrangler.production.jsonc` подключает kanata27.com/www к kanata-web. В GitHub Actions первый запуск — вручную, target preview. Дальнейшие действия — в START-HERE.md.

Публикуется только `dist`, сформированный по allowlist в `tools/build.mjs`. Не устанавливай assets.directory равным корню репозитория. `statistics-panel` при сборке становится `/stat-panel/`, как в прежнем Nginx. Исходный hero.jpg сохранён в репозитории, но в публикации используется лёгкий hero.webp.

Адрес действующего API задан в `site.config.json`. Скриптов создания новой базы, сброса пароля и удаления AWS-ресурсов в проекте нет. Dockerfile оставлен только для локального Nginx-preview; заголовки и перенаправления Cloudflare проверяются через `npm run dev`, а не через Nginx.
