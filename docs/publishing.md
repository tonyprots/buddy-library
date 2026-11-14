# Подготовка публикации

Локальная поставка готовится отдельно от создания репозитория и загрузки релиза.
Репозиторий: https://github.com/tonyprots/buddy-library. Публичное имя автора —
Anton Protsenko, как в профиле GitHub. Имя пакета и существующий копирайт сохранены.

## Страница репозитория

Предлагаемое About:

> Анимированный 3D-герой для HTML-презентаций: один локальный скрипт, автономные
> трюки и реакции на слайды, без сервера и внешних зависимостей.

Точные topics: `html-presentation`, `presentation`, `javascript`, `animation`,
`threejs`, `webgl`, `mascot`, `offline`.
Это тематические метки, не обещание роста позиций или звёзд.

README уже содержит назначение, реальное изображение, готовый файл в dist,
минимальное подключение и ссылку на инструкцию агенту. Демо пока локальное;
не указывать вымышленную ссылку на Pages.

## Первый выпуск

После явного разрешения на публикацию:

1. Создать репозиторий из чистого source-экспорта без прежней git-истории.
2. Сверить repository/homepage/bugs/author и ссылки на Releases в README и
   docs/api.md; затем обновить упаковку.
3. Убрать пометку кандидата у публикуемой версии в CHANGELOG.
   Исторические локальные поставки не выдавать за уже опубликованные релизы.
4. Подготовить тег v0.9.0 и GitHub Release с buddy-0.9.0-web.zip,
   tony-prots-buddy-0.9.0.tgz и checksums-0.9.0.json. Если в контрольных суммах
   указан source ZIP, приложить и buddy-0.9.0-source.zip.
5. Проверить скачивание по ссылкам релиза и подключение из скачанного архива.
   До отдельного решения не выполнять npm publish и не обещать установку из реестра.

manifest.sha256.json относится к конкретному экспорту, а не к исходникам:
он включён в ZIP и исключён из git.

## О видимости проекта

GitHub ищет репозитории по имени, описанию и topics; README ищется при
`in:readme`. Npm использует description и keywords. llms.txt здесь — навигация
для агентов, а не средство улучшить ранжирование Google.

Документация: [поиск GitHub](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories),
[topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics),
[поля npm](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/).
