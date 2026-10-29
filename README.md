# IST · каталог-фильтр ноутбуков

Учебный проект: сайт-подборщик ноутбука «под задачу». HTML/CSS + Node.js (Express),
хранилище — JSON-файл с характеристиками моделей.

## Запуск

```bash
npm install
npm start        # http://localhost:3000
# или в режиме разработки (автоперезапуск):
npm run dev
```

## Как это работает

Пользователь выбирает цель — «Игры», «Учёба и офис», «Программирование»,
«Дизайн и видео», «Лёгкий и автономный», «Бюджетный». Каждой цели соответствует
профиль требований (см. `lib/profiles.js`): обязательные (`must`) и желательные
(`nice`) пороги — мощность CPU (баллы PassMark-подобные), уровень GPU, объём
RAM/SSD, вес, автономность, цена. Сервер оставляет только модели, проходящие
все обязательные требования, и считает процент соответствия.

Поверх цели работают обычные фильтры: цена (двусторонний слайдер), бренд,
RAM, накопитель, диагональ, вес, автономность, частота и матрица экрана,
плюс поиск по модели/CPU/GPU и сортировки.

## REST API

| Метод | Endpoint | Что делает |
|---|---|---|
| GET | `/api/profiles` | описания всех целей и их порогов |
| GET | `/api/filters` | списки для фильтров + счётчики моделей по целям |
| GET | `/api/laptops` | каталог: `?purpose=gaming&search=rog&brand=ASUS&priceMin=&priceMax=&ramMin=&storageMin=&screenMin=&weightMax=&batteryMin=&hzMin=&panel=OLED&sort=match|rating|price_asc|price_desc|new` |
| GET | `/api/laptops/:id` | карточка + проценты соответствия по всем целям |
| GET | `/api/laptops?ids=a,b,c` | записи для сравнения (2–3 модели) |
| GET | `/api/health` | `{ ok, laptops }` |

## Данные: подключение своего набора (Kaggle)

Базовый каталог — `data/laptops.json` (38 моделей, стартовый набор, **цены в BYN**).
Чтобы развернуть его на полный датасет Kaggle:

1. Скачайте любой CSV с ноутбуками/ценами, например поиск по Kaggle:
   «laptop price dataset», «laptops specifications». Или положите файл в `data/raw/`.
2. Converter понимает распространённые схемы колонок (Company/Product,
   cpu_model/gpu_model, ram/memory, Price_euros, price_in_rupees и т.д.),
   недостающие параметры добирает регэкспами.

```bash
npm run import -- путь/к/файлу.csv                # локальный файл
npm run import -- "https://…/laptops.csv"          # прямая ссылка на CSV
npm run import                                     # из data/raw/*.csv
npm run import -- файл.csv --rate-usd=3.1 --rate-eur=3.45 --rate-rub=0.0339
```

Цены конвертируются в **BYN** по указанным курсам (по умолчанию
1 EUR ≈ 3.45, 1 USD ≈ 3.1, 1 RUB ≈ 0.034), прежний файл сохраняется
как `data/laptops.backup.json`. Если сервер запущен, он подхватит
обновление без перезапуска (следит за mtime файла).

> Примечание: батарея в Wh конвертируется в часы «на глаз» (Wh / 7), баллы CPU
> при отсутствии в CSV берутся из встроенного словаря типовых процессоров.

## Настоящие фотографии ноутбука

Поле `image` в `data/laptops.json`: если ссылка есть — карточки показывают
фото, если нет (или ссылка умрёт) — автогенерируется SVG-иллюстрация,
интерфейс не ломается никогда.

```bash
# авто: Wikimedia Commons (свободные лицензии) → затем DuckDuckGo images
npm run images
npm run images -- --source=commons --only macbook --limit 5   # фильтры
npm run images -- --force                                     # перезаполнить

# ручной режим: images.csv с колонками «id,image» (без заголовка),
# id берите из data/laptops.json, ссылку — с любого каталога:
npm run images -- --from images.csv
```

Совпадение проверяется по токенам модели (поколение «m3», «e14» и т.п.
должны быть в названии файла), бан-лист отсекает фото батарей/клавиатур/мышек.
С домашней сети авто-поиск DuckDuckGo работает лучше, чем с датацентров.

## Структура

```
ist-website/
├── server.js                # Express: статика /public + API
├── lib/profiles.js          # профили целей (must/nice/exclude) и расчёт соответствия
├── routes/api.js            # REST эндпоинты
├── scripts/import-laptops.js# CSV (Kaggle) → data/laptops.json
├── scripts/fetch-images.js  # фото моделей: Commons/DuckDuckGo или CSV
├── data/laptops.json        # каталог моделей (цены в BYN)
└── public/
    ├── index.html           # каталог-фильтр
    ├── item.html            # карточка + режим сравнения (Chart.js radar)
    ├── css/styles.css       # тёмная/светлая темы, компоненты
    ├── vendor/…             # локальные копии Tailwind/FA/noUiSlider/Chart.js
    └── js/                  # lib.js (утилиты), app.js (каталог), item.js (карточка)
```

## Сторонние ресурсы

* Tailwind, Font Awesome (+вебшрифты), noUiSlider, Chart.js — **скопированы
  локально в `public/vendor`** — сайт работает и без доступа к CDN;
* Google Fonts (Inter/Manrope) с CDN, при недоступности — системные шрифты;
* фото моделей — Wikimedia Commons / ссылками из любого каталога (поле `image`);
