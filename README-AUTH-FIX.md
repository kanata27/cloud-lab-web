# Авторизация — актуальная версия

Прежняя проверка AWS Bearer заменена Cloudflare Access и проверкой RS256 JWT в Worker. Историческое исправление redirect для вызова AWS больше к этой версии не относится.

Следуй [MIGRATION-START.md](MIGRATION-START.md): Access приложения, один email, team/AUD и Worker Secret. Не возвращай старый код authorize из предыдущих архивов.
