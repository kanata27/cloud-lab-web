# kanata27.com

HTML/CSS/JS сайт, заработки, посещения и инсайты. Полный Cloudflare backend: Workers Static Assets + Worker + существующая D1; Cloudflare Access с кодом на один разрешённый email. Рабочего API AWS после миграции не требуется.

- **[Начать перенос](MIGRATION-START.md)** — настройка, preview, импорт, production.
- [Архитектура и безопасность](docs/ARCHITECTURE.md).
- [Проверки](docs/VERIFICATION.md).
- [Откат и резервные копии](docs/ROLLBACK.md).
- [Отключение AWS](docs/AWS-CLEANUP.md).
- [Логика заработков и валют](EARNINGS-SETUP.md).

## Разработка

Node.js 24. Установка и проверки:

```sh
npm ci
npm run build
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

Браузерные тесты запускают loopback-сервер с настоящим Worker, SQLite и изолированной подменой Access. RSA-подпись проверяется и в Node, и в workerd. Это не режим доступа в опубликованном Worker: тестовые cookie, ключи, сервер и фикстуры в публикацию не входят.

`npm run dev` запускает локальный Wrangler и локальную D1, но без настоящего Access JWT панель останется закрытой. Универсального dev-пароля или переключателя обхода нет. Для интерактивной проверки входа используется защищённый preview.

`feature/**` push публикует preview после тестов, без PR. Production — только main и READY=true; auto ещё требует PRODUCTION_ENABLED=true. Preview общий для feature-веток: последняя опубликованная ветка заменяет предыдущую.

Код Worker лежит в `worker/`, исходники панели в `statistics-panel/`, публичные файлы собираются по allowlist в `dist/`. Закрытый URL панели `/stat-panel/` сохранён. Секреты, дампы и SQL-экспорт держи в `private/`, вне Git.
