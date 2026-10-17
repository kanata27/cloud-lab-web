# Полный перенос kanata27.com в Cloudflare

Подготовлено 17.10.2026 по твоему ZIP, исходникам двух Lambda и экспорту `kanata-analytics`. Проект и данные в аккаунтах пока не переключены. Начинай с preview; AWS оставь до сверки production.

После переноса сайт, посещения, заработки и инсайты работают в Cloudflare. Вход — код на разрешённый email через Cloudflare Access. Прежние логин, пароль и AWS-токены больше не используются. Фото, оформление и существующие записи заработков сохранены.

## 1. Подготовить ветку и резервные копии

1. Сохрани текущий рабочий коммит и номер последней рабочей версии Worker `kanata-web` в Cloudflare → Workers & Pages → kanata-web → Deployments.
2. Создай локальную ветку `feature/full-cloudflare`. Скопируй файлы проекта в корень своего репозитория с заменой, включая `.github`. Пока не отправляй push: feature-ветка автоматически выкатывается на preview.
3. В GitHub → Settings → Secrets and variables → Actions → Variables выставь **repository variable** `CLOUDFLARE_PRODUCTION_ENABLED=false`. Новую переменную `CLOUDFLARE_FULL_MIGRATION_READY` пока не создавай или оставь `false`.
4. Проверь существующие базы D1. В конфигурациях уже оставлены твои ID:

| Среда | Worker | D1 | Database ID |
|---|---|---|---|
| preview | kanata-web-preview | kanata-earnings-preview | 904123f3-aad7-49bf-94b9-5159e191e968 |
| production | kanata-web | kanata-earnings-production | 8bfb46ec-55d4-43e0-85fc-47fcb67f927a |

Новые базы создавать не нужно. Обе теперь содержат заработки и посещения своей среды. Название binding `EARNINGS_DB` оставлено для совместимости.

Открой терминал в корне проекта. Нужен Node.js 24; `npx wrangler login` откроет вход в твой Cloudflare. Команды не передают секреты в чат.

```sh
npm ci
npx wrangler login
```

Создай папку `private` в проекте (она исключена из Git). Сохрани обе базы перед миграцией:

```sh
npx wrangler d1 export EARNINGS_DB --remote --config wrangler.preview.jsonc --output private/preview-before-migration.sql
npx wrangler d1 export EARNINGS_DB --remote --config wrangler.production.jsonc --output private/production-before-migration.sql
```

Убедись, что файлы не пустые. Храни их приватно. Не отправляй базы заработков, исходный JSON или SQL импорта в GitHub и не загружай их в публичные Artifacts.

## 2. Включить вход по коду на email

Cloudflare → **Zero Trust** (в некоторых меню **Cloudflare One**). Если организация ещё не создана, выбери Free и придумай имя команды. Сохрани адрес команды вида `https://имя.cloudflareaccess.com`.

Открой **Integrations → Identity providers → Add new identity provider → One-time PIN** и сохрани. В интерфейсе с прежним меню это **Settings → Authentication → Login methods**. Для этого проекта достаточно One-time PIN.

Затем **Access controls → Applications → Add an application / Create new application → Self-hosted** (может называться **Self-hosted and private**).

Создай приложение **kanata preview panel**:

- Session duration: **8 hours**.
- Добавь три **Public hostname** в рамках одного приложения:

| Domain | Path |
|---|---|
| preview.kanata27.com | /stat-panel |
| preview.kanata27.com | /api |
| preview.kanata27.com | /earnings-api |

Правило пути распространяется на вложенные пути. Корень сайта `/` и `/events` в это приложение не включай: посетители QR должны открывать сайт без входа.

В **Access policies → Add a policy**:

| Поле | Значение |
|---|---|
| Policy name | Only Roman |
| Action | Allow |
| Include → Selector | Emails |
| Value | Один твой точный email, на который придёт код |

Не выбирай `Everyone`, домен почты целиком, Bypass или Service Auth. При такой Allow-политике остальные адреса не получают доступ. В Login methods выбери только **One-time PIN**. Сохрани приложение.

В настройках приложения найди **Application Audience (AUD) Tag**, иногда во вкладке Overview. Скопируй значение из 64 символов. В `wrangler.preview.jsonc` замени:

```json
"ACCESS_TEAM_DOMAIN": "https://твоя-команда.cloudflareaccess.com",
"ACCESS_AUD": "сюда-AUD-приложения-preview"
```

Это настройки, а не секретные ключи: их можно хранить в репозитории. AUD не сокращай и не добавляй пробелы.

Аналогично создай **kanata production panel** — отдельное приложение с тем же email, One-time PIN, 8 часами и тремя путями на **kanata27.com**. Его собственный AUD впиши в `wrangler.production.jsonc`. Адрес команды одинаковый, AUD у приложений разные.

`www` служит публичным псевдонимом: закрытые страницы с него перенаправляются на `kanata27.com`. Приложение Access на весь домен не нужно. Cloudflare Tunnel тоже не нужен.

Создание production Access временно заменит прежний экран входа экраном кода. Новая проверка Worker вступит в силу после публикации; поэтому до этого шага используй preview для проверки и не считай старую публичную версию защищённой новым Worker.

## 3. Добавить разрешённый email в оба Worker

Cloudflare → **Workers & Pages → kanata-web-preview → Settings → Variables and Secrets → Add**:

| Поле | Значение |
|---|---|
| Type | Secret |
| Variable name | ACCESS_ALLOWED_EMAIL |
| Value | Тот же один точный email из политики Access |

Нажми Save/Deploy. Повтори для **kanata-web**. Этот секрет проверяет сам Worker даже при ошибке в политике Access. Не подставляй список адресов, имя пользователя или пароль.

Альтернатива через терминал: команды запросят значение интерактивно; введи свой email.

```sh
npx wrangler secret put ACCESS_ALLOWED_EMAIL --config wrangler.preview.jsonc
npx wrangler secret put ACCESS_ALLOWED_EMAIL --config wrangler.production.jsonc
```

GitHub Secrets `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID` остаются прежними. Токену нужны Account → Workers Scripts → Edit, D1 → Edit, Account Settings → Read; Zone → Workers Routes → Edit, Zone → Read, DNS → Edit, только твои аккаунт и домен. Право управлять Access через GitHub не требуется: приложения настроены вручную.

До выкладки проверь:

```sh
node tools/check-earnings-config.mjs preview
node tools/check-earnings-config.mjs production
```

Без токена в терминале проверяются файлы. В GitHub Actions дополнительно проверяется наличие секрета по его имени; значение не выводится. Плейсхолдеры останавливают выкладку.

## 4. Выложить preview

Теперь commit и push `feature/full-cloudflare`. GitHub → **Actions → Cloudflare site**. Зелёные `check` и `deploy` публикуют preview без Pull Request. Повторный ручной запуск: **Run workflow → feature/full-cloudflare → preview**.

Миграции только добавляют таблицы посещений; записи заработков остаются на месте. Проверка сайта после деплоя не отправляет события и не запрашивает коды входа.

Открой:

- Сайт: https://preview.kanata27.com/
- Заработки: https://preview.kanata27.com/stat-panel/earnings
- Посещения: https://preview.kanata27.com/stat-panel/
- Инсайты: https://preview.kanata27.com/stat-panel/insights

Впиши разрешённый email → введи код из письма. Старого пароля панели больше нет. Открой приватное окно с другой почтой: содержимое панели и API не должны открываться. Неверный email в Worker даёт отказ даже после входа Access.

## 5. Импортировать переданную историю в preview

В отдельном архиве `kanata-analytics-history-private.zip` лежит уже подготовленный `analytics-import.sql`. Распакуй его в `private/analytics-import.sql` внутри локального проекта. Сам архив и содержимое не коммить.

После успешного preview-деплоя:

```sh
npx wrangler d1 execute EARNINGS_DB --remote --config wrangler.preview.jsonc --file private/analytics-import.sql
```

В Visits выбери **16.09.2026–15.10.2026**, источник «Все». В переданном экспорте:

| Показатель | Значение |
|---|---|
| Сессии | 76 |
| Просмотры | 89 |
| Переходы | 27 |
| YouTube | 18 |
| Instagram | 9 |
| Сессии с переходом | 20 |

Preview пишет новые пробные посещения в собственную D1. Они не попадут в production; проверка старого периода отделяет их от истории. Повторный импорт безопасен: он не прибавляет одну историю второй раз и не стирает новые Cloudflare-события.

Проверь добавление, редактирование и удаление пробного заработка, графики, даты, источники, инсайты, выход и повторный вход. Кнопка «Выйти» завершает браузерную Access-сессию; возврат назад не должен снова показывать отчёт. Настоящую доставку OTP и правила твоего аккаунта проверяем именно здесь — локальные тесты не отправляли письма.

## 6. Подготовить основной домен

Сначала ещё раз экспортируй production D1, чтобы резервная копия заработков была свежей. Сохрани экспорт DNS и рабочую версию Worker.

Убедись, что production Access настроен и секрет добавлен. Слей проверенную ветку в `main`. При `CLOUDFLARE_FULL_MIGRATION_READY=false` production-job пропускается намеренно.

В **GitHub → Settings → Secrets and variables → Actions → Variables → New repository variable**:

```text
Name: CLOUDFLARE_FULL_MIGRATION_READY
Value: true
```

Именно **repository variable**, не environment variable. `CLOUDFLARE_PRODUCTION_ENABLED` пока оставь `false`: так ручной запуск разрешён, а автоматический push ещё не переключает сайт.

Далее **Actions → Cloudflare site → Run workflow → Branch: main → Target: production**. Это реальная публикация. После неё новые страницы отправляют посещения в D1 и читают отчёты из неё. До импорта старая история в production ещё не видна; заработки должны остаться.

Сразу импортируй базовую историю:

```sh
npx wrangler d1 execute EARNINGS_DB --remote --config wrangler.production.jsonc --file private/analytics-import.sql
```

Это не финальная сверка: экспорт заканчивается 15 октября. Перенеси также всё, что успело накопиться в AWS позже, по шагу 7.

## 7. Сделать финальную выгрузку AWS и сверку

Оставь старый сборщик включённым на переходный период, например сутки: ранее открытые вкладки ещё могут отправлять клики на прежний AWS URL. Новые вкладки уже используют Cloudflare. Экспорт можно повторять по мере необходимости — новые счётчики D1 сохранятся.

Для окончательной выгрузки останови запись в **kanata-analytics-api**, регион **eu-north-1**. Сначала запиши прежнюю настройку concurrency функции. AWS Console → Lambda → эта функция → Configuration → Concurrency → Edit → Reserved concurrency = **0**. `kanata-analytics-read` пока не отключай. Дождись завершения текущих вызовов и убедись, что запись остановилась. После этой остановки события из очень старых открытых вкладок в AWS уже не сохранятся; поэтому сначала выдерживаем переходный период. Строгая доставка событий со старых вкладок этим проектом не гарантируется.

На компьютере с настроенным AWS CLI выполни одну команду без `--limit`, `--max-items` и `--no-paginate`:

```sh
aws dynamodb scan --table-name kanata-analytics --region eu-north-1 --consistent-read --output json > private/kanata-analytics-final.json
node tools/import-analytics.mjs private/kanata-analytics-final.json private/analytics-import-final.sql
npx wrangler d1 execute EARNINGS_DB --remote --config wrangler.production.jsonc --file private/analytics-import-final.sql
```

Конвертер откажется от очевидно неполной выгрузки или некорректных записей. DynamoDB Scan не является общей моментальной транзакцией: именно поэтому финальный Scan делается после остановки старого writer. Не отправляй JSON/SQL в GitHub. Импорт меняет только базовые AWS-счётчики, новые Cloudflare-счётчики остаются отдельно.

Проверь старый период и новые посещения, заработки на двух устройствах, отсутствие доступа в приватном окне. Для реальной проверки QR открой `https://kanata27.com/?q=street`, дождись просмотра, нажми YouTube; открой Visits за сегодня UTC. Это создаёт настоящие события. Старые счётчики сохраняют логику AWS: вся активность сессии относится к дню её первого просмотра.

Если всё работает, выставь **repository variable** `CLOUDFLARE_PRODUCTION_ENABLED=true`. Дальше feature-push автоматически публикует preview, merge/push `main` — production после проверок. Pull Request сам ничего не публикует.

## 8. Удалить AWS только после проверки

Порядок — в [docs/AWS-CLEANUP.md](docs/AWS-CLEANUP.md). Ни workflow, ни этот архив ничего в AWS не удаляют. Сначала сохраняются исходники, данные и настройки; потом отключаются проверенные ресурсы.

## Если что-то не открывается

| Симптом | Что проверить |
|---|---|
| production skipped | READY=true на уровне repository, запуск production из main; для auto ещё PRODUCTION_ENABLED=true |
| deploy: Set ACCESS… | team URL и AUD в файле нужной среды |
| Add ACCESS_ALLOWED_EMAIL | Worker Secret в нужном kanata-web / kanata-web-preview |
| После OTP 403 | email из политики совпадает с секретом, правильный AUD среды |
| 401 / «Доступ закрыт» без экрана кода | Access-приложение охватывает путь, затем открыть обычный /stat-panel/ заново |
| 503 проверки входа | настройки или доступность Access/JWKS; доступ остаётся закрытым |
| Курсы временно недоступны | повторить позже; случайные курсы не подставляются |
| Старых посещений нет | импорт сделан в D1 именно этой среды и выбран нужный диапазон |

Не отключай проверку JWT, не возвращай старый Bearer как обход и не ставь Bypass для решения ошибок входа. Откат и восстановление — [docs/ROLLBACK.md](docs/ROLLBACK.md).

Документация Cloudflare: [Access Self-hosted](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/), [One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/), [пути Access](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/), [проверка JWT](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
