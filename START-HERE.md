# Перенос kanata27.com в Cloudflare

Готовый проект собран на основе `kanata27/cloud-lab-web`, ветка `main`, коммит `0f8b39e4d87c233e10ef644276a8ae7854c76939` от 13 сентября 2026 года. Если после этого ты уже менял сайт, переноси изменения через отдельную ветку и сравнение файлов.

Сайт и панель будут раздаваться из **Cloudflare Workers Static Assets**. Твой действующий AWS API, Lambda, вход и таблицы DynamoDB продолжают работать. Новый пароль, JWT_SECRET, IAM role и второй бэкенд для этого переноса не нужны.

**Проект подготовлен локально. Никакие ресурсы в твоём аккаунте пока не переключены и не удалены.**

## 1. Загрузить проект в GitHub

1. Открой свою папку `cloud-lab-web` в VS Code. Сохрани или закоммить текущие изменения.
2. Слева внизу нажми на название ветки → **Create new branch** → `migration/cloudflare`.
3. Распакуй архив. Скопируй содержимое папки проекта в `cloud-lab-web`, включая `.github`, с заменой совпадающих файлов. Папку `.git` не переносить: её нет в архиве.
4. **Source Control** → проверь изменения → **Stage All Changes** → сообщение `Migrate frontend to Cloudflare static assets` → **Commit** → **Publish Branch**.
5. На GitHub открой **Compare & pull request** в `main`. После успешной проверки `check` нажми **Merge pull request**.

Новый `.github/workflows/deploy.yml` заменяет старый деплой в ECR/ASG. Обычный push пока запускает только проверки. Сайт в AWS продолжает работать на ранее опубликованной версии. Если у тебя дополнительно созданы другие workflows, которые деплоят тот же сайт в EC2 или Cloudflare Pages, отключи их в **Actions → нужный workflow → ⋯ → Disable workflow**, чтобы два процесса не управляли одним сайтом.

## 2. Добавить доступ к Cloudflare

Cloudflare → значок профиля → **My Profile → API Tokens → Create Token → Create Custom Token**.

Название: `github-kanata-web`. Разрешения:

| Область | Разрешение | Доступ |
|---|---|---|
| Account | Workers Scripts | Edit |
| Account | Account Settings | Read |
| Zone | Workers Routes | Edit |
| Zone | Zone | Read |
| Zone | DNS | Edit |

В **Account Resources** выбери только свой аккаунт, в **Zone Resources** — только `kanata27.com`. Создай токен и сохрани его в менеджере паролей. Global API Key не нужен.

**Account ID** скопируй на странице своего аккаунта или в обзоре домена в Cloudflare. Нужен Account ID, не Zone ID.

GitHub → `cloud-lab-web` → **Settings → Secrets and variables → Actions → Secrets → New repository secret**:

| Имя | Значение |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Созданный токен |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID из Cloudflare |

В **Settings → Environments** создай `preview` и `production`. Для `production` в **Deployment branches and tags** выбери **Selected branches and tags** и разреши только `main`.

## 3. Разрешить пробный адрес в AWS API

AWS → регион **Europe (Stockholm), eu-north-1** → **API Gateway → APIs** → API с ID **`dupt8l46y1`** → **CORS → Configure**.

В существующий список **Access-Control-Allow-Origin** добавь два адреса; основной оставь:

```text
https://kanata27.com
https://www.kanata27.com
https://preview.kanata27.com
```

| Поле | Значение |
|---|---|
| Allow methods | `GET`, `POST`, `OPTIONS` |
| Allow headers | `authorization`, `content-type` |
| Max age | `600` |
| Allow credentials | Выключено |

Нажми **Save**. Если у stage выключен **Auto-deploy**, опубликуй изменения в этот stage через **Deploy**. Если уже есть другие нужные origins/headers, сохрани их тоже. Звёздочку `*` вместо конкретных сайтов не добавляй.

Текущий фронтенд использует `Authorization: Bearer …`, а не cookies. `OPTIONS` должен проходить без авторизации. Если за `$default` стоит authorizer, для preflight нужен открытый маршрут `OPTIONS /{proxy+}`. [Документация AWS по CORS](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html).

## 4. Опубликовать и проверить preview

GitHub → **Actions → Cloudflare site → Run workflow**:

- Branch: `main`.
- Target: `preview`.
- Нажми **Run workflow**.

Деплой создаст `kanata-web-preview` и подключит **https://preview.kanata27.com**. Предварительно создавать Pages-проект или CNAME на `workers.dev` не нужно. Перед изменением DNS workflow проверяет существующие записи и сохраняет их в Summary и Artifacts запуска.

После зелёного `deploy` открой:

- [Пробный сайт](https://preview.kanata27.com/).
- [Вход в панель](https://preview.kanata27.com/stat-panel/login.html).

Проверь фотографию и ссылки с телефона и ПК; войди своим действующим логином и паролем; выбери день, неделю, источник QR; нажми «Выйти». Preview читает настоящую статистику через существующий защищённый API, но не отправляет просмотры и клики в аналитику.

После первого создания домена выпуск сертификата может занять время. Если публикация завершилась, а проверка HTTPS ещё упала, посмотри **Cloudflare → Workers & Pages → kanata-web-preview → Settings → Domains & Routes**. Дождись активного сертификата и повтори проверку/запуск. Ошибка CORS требует исправления шага 3, а не отключения авторизации. Если сама Lambda отдельно проверяет Origin, в её текущий allowlist тоже понадобится добавить preview; её исходников в этом репозитории нет.

## 5. Переключить основной сайт

Выполни после успешного входа и проверки preview. Перед переключением сохрани текущие DNS-записи: **Cloudflare → kanata27.com → DNS → Records → Import and Export → Export**. Старый ALB и EC2 пока оставь работающими.

GitHub → **Actions → Cloudflare site → Run workflow → main → production → Run workflow**.

**Этот запуск переключает настоящие `kanata27.com` и `www.kanata27.com` на Cloudflare.** В закреплённой версии Wrangler запуск из GitHub Actions обновляет конфликтующие DNS-записи custom domain сам. Удалять запись `@` заранее не требуется. Перед публикацией проверяется, что адрес ведёт на известный ALB либо уже принадлежит этому Worker; неожиданный адрес остановит деплой для разбора.

Проверь [основной сайт](https://kanata27.com/) и [панель](https://kanata27.com/stat-panel/login.html). Один раз открой сайт с `?q=street`, нажми YouTube, затем проверь событие в панели. Это будут настоящие события. Если печатный QR уже содержит этот адрес, перепечатывать его не нужно: имя и метка `q` сохраняются.

Ссылки вида `/stat-panel/index.html` и `/stat-panel/login.html` могут получить перенаправление Cloudflare на адрес без `.html`. Страницы и логин продолжают работать, старые закладки сохранены.

## 6. Включить дальнейшие обновления

После успешного переключения: GitHub → **Settings → Secrets and variables → Actions → Variables → New repository variable**.

```text
Name:  CLOUDFLARE_PRODUCTION_ENABLED
Value: true
```

Теперь merge/push в `main` запускает проверки и публикацию в Cloudflare. Feature-ветки не публикуются в production. Деплои одной среды выполняются последовательно; файлы загружаются до переключения версии. Два постоянно работающих EC2 для этого не нужны.

Для будущей фичи сначала отправь свою ветку в GitHub, затем **Run workflow → выбери эту ветку → preview**. Проверь её на preview-домене и только потом сливай в `main`. Если main изменится, пока старый production-запуск проходит проверки, этот устаревший запуск остановится до изменения DNS/деплоя.

## 7. Отключить старые расходы

После периода проверки, например суток, переходи к **[docs/AWS-CLEANUP.md](docs/AWS-CLEANUP.md)**. Там разделены ресурсы старого сайта и действующий бэкенд. Основную экономию даст выключение ASG/EC2 и удаление ALB, а не перенос базы.

## Если нужен откат

Сначала выставь `CLOUDFLARE_PRODUCTION_ENABLED=false`, чтобы новый push не перекрыл ручной откат.

**После последующих обновлений:** Cloudflare → **Workers & Pages → kanata-web → Deployments** → выбери предыдущую рабочую версию → **Rollback**. Затем верни рабочий код в GitHub до включения автодеплоя. Откат фронтенда не откатывает DynamoDB.

**При самом первом переносе:** пока старые ALB/EC2 работают, убери `kanata27.com` и `www.kanata27.com` из **kanata-web → Settings → Domains & Routes**, затем восстанови записи из DNS-экспорта или `dns-before-production` в Artifacts запуска. Известный прежний target: `cloud-lab-alb-963312302.eu-north-1.elb.amazonaws.com`, тип CNAME; статус Proxy и TTL возьми из сохранённых значений. Не меняй `api`, записи проверки ACM, почтовые записи и nameservers.

Глобальное обновление DNS и сертификатов нельзя гарантировать мгновенно. Поэтому старые ресурсы удаляются только после проверки основного домена. [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [откат Workers](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
