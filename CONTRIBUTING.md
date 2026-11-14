# Разработка

Этот файл для тех, кто меняет саму библиотеку. Пользователю пакета хватит
[README](README.md). В npm-пакет попадают только файлы из поля `files`
в `package.json`; всё, что описано ниже, остаётся в репозитории.

## Устройство

| Файл | Назначение |
|---|---|
| `index.js` | `createBuddy`, проверка настроек, каталог и пресеты |
| `behavior.js`, `playback.js` | Общая политика автоматического выбора, сценарии и отмена |
| `brand.js` | Общий набор бренда и адаптация прежних сервисных ключей в роли |
| `runtime.js` | Скелет, физика, карта опор, движения, своя жизнь |
| `vendor.js` | Three.js r186, GLTFLoader, модель Quaternius и 3D-риг одним модулем |
| `new-abilities.js`, `ability-props.js` | Дополнительные номера и их объёмный реквизит |
| `slide-intelligence.js` | Классификация слайдов, планировщик `autoplay`, реакции |
| `slide-context.js`, `context-*.js` | Факты слайда и 17 контекстных историй |
| `camera.js` | Кадрирование стенда `index.html` |
| `effects.js` | Интро со взрывом обложки |
| `presets/y360.js` | Номера со знаками сервисов, выключены по умолчанию |
| `scripts/build.mjs` | Основной `dist/buddy.js` и отдельный пример `dist/buddy-y360.js` |

Внутренние заметки для авторов движений — в `docs/dev/`: контракт рига
и реквизита, реквизит способностей, рендерер и качество рисовки.

## Команды

```bash
npm install          # только esbuild для сборки dist/
npm run check        # синтаксис всех модулей
npm test             # быстрый набор, около 20 с
npm run test:slow    # тяжёлая геометрия контактов и зазоров, около 45 с
npm run test:all     # оба набора
npm run build        # dist/buddy.js
npm pack             # перед упаковкой сборка запускается сама (prepack)
npm run export -- drafts/public-export  # Python 3: web/source ZIP без приватного дерева
```

Тесты не требуют браузера и зависимостей: DOM подменяется фикстурами
из `tests/support/`. `tests/slow/` проверяет настоящую геометрию модели
(ладони, глаза, зазоры реквизита) по всему циклу движения с шагом до 120 Гц.

## Браузерные проверки

`tests/browser/` — сценарии на локальном Chromium через CDP без сторонних
зависимостей. Браузер ищется сам; другой путь задаётся `BUDDY_CHROME`.
Отчёты и кадры пишутся в `drafts/` (не попадает ни в git, ни в пакет).

```bash
node tests/browser/browser-check.mjs            # жизненный цикл, пресеты, приёмы, реакции, интро
node tests/browser/context-browser-check.mjs    # контекст слайда, первая серия
node tests/browser/context-stories-browser-check.mjs
node tests/browser/behavior-browser-check.mjs
```

Запускайте их по одному. Сценарии для личных презентаций не входят в публичную поставку.
`*-capture.mjs` снимают покадровые ролики для ручного просмотра.

Для проверки движения в масштабе целого слайда:

```bash
BUDDY_CAPTURE_IDS=climb BUDDY_CAPTURE_VIEW=overview \
  BUDDY_CAPTURE_PERFORMANCE=0 BUDDY_REPORT_DIR=drafts/climb-overview \
  node tests/browser/catalog-quality-capture.mjs
```

`BUDDY_CAPTURE_VIEW` выбирает камеру записи: `overview` — весь слайд,
`closeup` — крупный план, `auto` — автокадр (по умолчанию).
Дополнительные крупные фазы сохраняются во всех режимах. `BUDDY_PERF_VIEW`
независимо задаёт ракурс замера производительности. Для каждого нового снимка
исходников или настроек нужна новая папка: сборщик проверяет хэши при продолжении.
Видео содержит модельные 24 кадра/с и само по себе не доказывает реальный FPS.

## Как добавить движение

Основные действия — в `runtime.js`, дополнительные — в `new-abilities.js`,
их объёмные предметы — в `ability-props.js` (через `prop3`). Реестр
`techniques` в `index.js` — единственный каталог для API и стенда; новый ID
нужно добавить и в `TechniqueId` в `index.d.ts` (это проверяет тест).

Порядок работы: сценическая задача и условия запуска, затем поза, тайминг,
эффект и очистка. У скелета скалярные каналы `rot`, `tl`, `ts`, `hp`, `hy`,
`mouth`, `smile`, `lid`, `brow` и парные `sf`, `sa`, `ef`, `ea`, `hf`, `ha`,
`kf`, `ka`, `af`. Угол предплечья задаётся в абсолютных осях (`sf + ef`).
Для кистей 3D-риг принимает `handOpen`, `handFist`, `handShape`.

- Позы под реквизит подбирайте по целевым координатам кистей:
  `buddy.experimental.kin(pose)` отдаёт суставы и оси головы.
- Общую константу позы нельзя мутировать во время кадра — копируйте её.
- На каждом кадре не создавайте DOM-узлы, векторы и материалы: создавайте
  при старте, обновляйте значения, удаляйте при завершении и прерывании.

## Выпуск

Экспорт создаёт отдельное дерево исходников без истории git, внутренних заметок
и личных дек. Именно оно предназначено для будущего репозитория.
Скрипт отказывается перезаписывать результаты; для следующего запуска выберите
новую папку. ZIP имеет фиксированные метаданные и manifest.sha256.json.
Создание репозитория, push и npm publish выполняются отдельно, по решению владельца.
Подготовка страницы репозитория и выпуска — в [памятке публикации](docs/publishing.md).
Для дополнительных локальных ограничений экспорта задайте
`BUDDY_EXPORT_PRIVATE_TERMS` как JSON-массив строк. Эти строки проверяются
при экспорте, но не записываются в публичные файлы.

1. Обновить версию в `package.json` и запись в `CHANGELOG.md`.
2. `npm run check && npm run test:all`.
3. `npm pack` и проверка архива в чистой папке, как у внешнего пользователя:

   ```bash
   mkdir /tmp/buddy-app && cp tests/browser/package-check/*.{html,css,js} /tmp/buddy-app/
   cd /tmp/buddy-app && npm init -y && npm install /путь/к/tony-prots-buddy-X.Y.Z.tgz
   npx esbuild app.js --bundle --format=esm --outfile=bundle.js
   for s in life classic bundled scenes effects keys reduced; do
     node /путь/к/библиотеке/tests/browser/package-check/verify.mjs /tmp/buddy-app $s
   done
   ```

   Сценарии проверяют страницу из README через ES-модули, `dist/buddy.js`
   через `file://`, сборку сборщиком, сцены, интро, клавиши и reduced motion.
   Кадры сохраняются в `/tmp/buddy-app/shots/`.
