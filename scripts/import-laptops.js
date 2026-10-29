#!/usr/bin/env node
/**
 * Загружает CSV-датасет с ноутбуками (Kaggle) и превращает его
 * в data/laptops.json для каталога.
 *
 * Использование:
 *   npm run import                                    — берёт data/raw/*.csv
 *   npm run import -- путь/к/файлу.csv                — локальный файл
 *   npm run import -- "https://.../data.csv"          — прямая ссылка на CSV (axios)
 *
 * Опции:
 *   --rate-eur=100   курс EUR → ₽   (по умолчанию 100)
 *   --rate-usd=92    курс USD → ₽   (по умолчанию 92)
 *   --rate-inr=1.05  курс INR → ₽   (по умолчанию 1.05)
 *
 * Скрипт терпим к колонкам: понимает разные схемы Kaggle-датасетов
 * (Company/Product, cpu_model/gpu_model, price_euros и т.д.), а желаемые
 * параметры (частота, тип матрицы, разрешение) и missing-поля добирает
 * текстовыми регэкспами. Батарея в Wh конвертируется в часы "на глаз".
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import axios from 'axios';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const RAW_DIR = path.join(DATA_DIR, 'raw');
const OUT_FILE = path.join(DATA_DIR, 'laptops.json');

/* ------------------------------------------------------------------ */
/* Аргументы                                                           */
/* ------------------------------------------------------------------ */
const args = process.argv.slice(2);
// курсы → BYN (белорусские рубли): 1 EUR ≈ 3.45, 1 USD ≈ 3.1, 1 RUB ≈ 0.034, 1 INR ≈ 0.037
const rates = { eur: 3.45, usd: 3.1, rub: 0.0339, inr: 0.037 };
for (const a of args) {
  const m = a.match(/^--rate-?(eur|usd|rub|inr)=(\d+(?:[.,]\d+)?)$/i);
  if (m) rates[m[1].toLowerCase()] = parseFloat(m[2].replace(',', '.'));
}
const source = args.find((a) => !a.startsWith('--'));

/* ------------------------------------------------------------------ */
/* Справочники                                                         */
/* ------------------------------------------------------------------ */
// Многопоточные баллы (PassMark-подобные) для типовых CPU, если в CSV их нет
const CPU_SCORES = {
  'i3-1215u': 9700, 'i3-1225u': 10700, 'i3-n305': 9800,
  'i5-1235u': 11700, 'i5-12450h': 14900, 'i5-12500h': 17900,
  'i5-1335u': 13600, 'i5-13420h': 14300, 'i5-13500h': 18300,
  'i5-1340p': 13800, 'i5-1240p': 10800, 'i7-1355u': 13200,
  'i7-13620h': 22800, 'i7-13700h': 26500, 'i7-13650hx': 30200, 'i7-13700hx': 31900,
  'r3-7320u': 9000, 'r5-7520u': 8900, 'r5-7530u': 15300, 'r5-7535u': 16200,
  'r5-7640hs': 21400,
  'r7-7730u': 18700, 'r7-7735hs': 21100, 'r7-7840hs': 27200,
  // варианты написания «Ryzen n …» (усечённые ключи не матчатся, т.к. в строке есть слово «ryzen»)
  'ryzen 3 7320u': 9000,
  'ryzen 5 7520u': 8900, 'ryzen 5 7530u': 15300, 'ryzen 5 7535u': 16200, 'ryzen 5 7640hs': 21400,
  'ryzen 7 7730u': 18700, 'ryzen 7 7735hs': 21100, 'ryzen 7 7840hs': 27200,
  'ultra 5 125h': 24600, 'ultra 7 155h': 29900, 'ultra 7 255h': 34000,
  'apple m1': 13100, 'apple m2': 14900, 'apple m3': 16400, 'apple m4': 22900,
};

// Поиск баллов: ищем вхождение ключа словаря в нормализованной строке CPU
function lookupScore(cpu) {
  const n = norm(cpu);
  if (!n) return null;
  let best = null;
  let bestLen = 0;
  for (const [k, v] of Object.entries(CPU_SCORES)) {
    const nk = norm(k);
    if (n.includes(nk) && nk.length > bestLen) {
      best = v;
      bestLen = nk.length;
    }
  }
  return best;
}

function inferGpuTier(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return 0;
  if (/\b(rtx|gtx)\s*(40|50)(80|90)\b|rtx\s*5080|rtx\s*5090|4080|4090/.test(n)) return 5;
  if (/(4060|4070|3070|3080|5060|5070)/.test(n)) return 4;
  if (/(4050|3050|3060|2060|5050)/.test(n)) return 3;
  if (/(2050|mx\d{3}|arc)|\bm[1-9]|\b(680m|780m)\b/.test(n)) return 2;
  if (/(iris|uhd|vega|radeon|r[1-9x]\s|f hd|graphics)/.test(n)) return 1;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */
const clean = (v) =>
  String(v ?? '')
    .replace(/[\u201c\u201d"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function firstNum(v) {
  const m = String(v ?? '').match(/-?\d+(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(',', '.')) : null;
}

const norm = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const slug = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const clampNum = (v, min, max) =>
  v === null ? null : Math.min(max, Math.max(min, v));

/* ------------------------------------------------------------------ */
/* Парсеры полей                                                       */
/* ------------------------------------------------------------------ */
function parseRam(raw) {
  const n = firstNum(raw);
  if (n === null) return null;
  let v = n;
  if (v > 128 && v >= 8192) v = Math.round(v / 1024); // MB → GB
  return clampNum(Math.round(v), 2, 192);
}

function parseStorage(raw) {
  // «512GB SSD», «256GB SSD + 1TB HDD», «1,024 TB»…
  const matches = String(raw ?? '').matchAll(/(\d+(?:[.,]\d+)?)\s*(tb|gb)/gi);
  let total = 0;
  for (const m of matches) {
    const val = parseFloat(m[1].replace(',', '.'));
    total += m[2].toLowerCase() === 'tb' ? val * 1024 : val;
  }
  if (!total) return null;
  return clampNum(Math.round(total), 64, 8192);
}

function parseScreenSize(raw) {
  const n = firstNum(raw);
  if (n === null) return null;
  return n >= 10 && n <= 19 ? n : null;
}

function parseResolution(raw) {
  const m = String(raw ?? '').match(/\b(\d{3,4})\s*x\s*(\d{3,4})\b/i);
  return m ? `${m[1]}x${m[2]}` : null;
}

function parseHz(raw) {
  const m = String(raw ?? '').match(/(\d{2,3})\s*hz/i);
  const n = m ? parseInt(m[1], 10) : firstNum(raw);
  if (n === null) return null;
  return n > 30 && n <= 600 ? Math.round(n) : null;
}

function parsePanel(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (/oled/.test(s)) return 'OLED';
  if (/mini[ -]?led/.test(s)) return 'Mini-LED';
  if (/ips|\bled\b|led[\s-]*backlit|wled|pln/.test(s)) return 'IPS';
  if (/\btn\b/.test(s)) return 'TN';
  return null;
}

function parseWeight(raw) {
  const s = String(raw ?? '').toLowerCase();
  const n = firstNum(raw);
  if (n === null) return null;
  let v = n;
  if (/lbs|lb\b/.test(s)) v = n * 0.45359;
  else if (/^\s*\d{4,}\s*(g\b|$)/.test(s) || (!/kg|кг/.test(s) && n >= 500 && n <= 6000)) v = n / 1000;
  return clampNum(v, 0.3, 8) ? Math.round(v * 100) / 100 : null;
}

function parseBattery(raw) {
  const s = String(raw ?? '').toLowerCase();
  const n = firstNum(raw);
  if (n === null) return null;
  if (/wh\b/.test(s)) {
    // Ёмкость в ватт-часах → примерные часы работы (делим на ~7 Вт среднего потребления)
    return clampNum(Math.round(n / 7 * 10) / 10, 2, 20);
  }
  return clampNum(n, 1, 24);
}

function parsePrice(raw, currency) {
  const n = firstNum(raw);
  if (n === null || n <= 0) return null;
  const inByn = n * (rates[currency] ?? 3.45);
  return Math.round(inByn / 10) * 10;
}

/* ------------------------------------------------------------------ */
/* Маппинг колонок                                                     */
/* ------------------------------------------------------------------ */
const FIELDS = [
  ['brand', ['company', 'brand', 'manufacturer', 'vendor']],
  ['model', ['product', 'model', 'laptopname', 'name', 'laptop', 'title', 'productname']],
  ['cpu', ['cpu', 'cpumodel', 'processor', 'cpuname', 'processorname']],
  ['cpuScore', ['cpubenchmark', 'cpuscore', 'cpumark', 'benchmark', 'cpuscoremulti']],
  ['gpu', ['gpu', 'gpumodel', 'graphics', 'graphiccard', 'gpucompany']],
  ['gpuTier', ['gputier']],
  ['ram', ['ram', 'ramcapacity', 'rammemory', 'ramgb', 'ramsize']],
  ['storage', ['ssd', 'storage', 'storagecapacity', 'disk', 'hdd', 'memory']],
  ['screenSize', ['screensize', 'screen', 'inches', 'displaysize', 'displayinches']],
  ['resolution', ['resolution', 'displayresolution', 'screeeresolution', 'screenresolution']],
  ['hz', ['refreshrate', 'hz', 'refresh']],
  ['panel', ['displaytype', 'panel', 'screentype', 'display']],
  ['weight', ['weight', 'bodyweight']],
  ['battery', ['batterylife', 'battery', 'batterycapacity']],
  ['price', [
    'priceinr', 'pricerupee', 'pricerupees', 'priceinrupees',
    'priceusd', 'priceus', 'priceusdollar',
    'priceeur', 'priceeuro', 'priceeuros',
    'pricerub', 'pricerubles', 'price',
  ]],
  ['year', ['year', 'releaseyear']],
  ['rating', ['rating', 'stars', 'star', 'userscore']],
  ['os', ['os', 'opsys', 'operatingsystem']],
];

function detectCurrency(field) {
  if (/inr|rupee/.test(field)) return 'inr';
  if (/usd|us\b|dollar/.test(field)) return 'usd';
  if (/rub/.test(field)) return 'rub';
  return 'eur'; // CSV Kaggle чаще всего с ценой в евро
}

/* ------------------------------------------------------------------ */
/* Конвертация строки CSV → объект каталога                            */
/* ------------------------------------------------------------------ */
function convertRow(row, ctx) {
  const g = (field) => (ctx.map[field] !== undefined ? row[ctx.map[field]] : '');
  const text = Object.values(row).join(' ');

  const brand = clean(g('brand'));
  let model = clean(g('model'));
  if (!brand && !model) return null;
  if (model && brand && model.toLowerCase().startsWith(brand.toLowerCase())) {
    model = model.slice(brand.length).trim();
  }

  const cpu = clean(g('cpu')) || null;
  const gpu = clean(g('gpu')) || null;

  const priceField = ctx.map.price;
  const currency = priceField ? detectCurrency(norm(priceField)) : 'eur';

  const item = {
    brand: brand || 'Unknown',
    model: model || 'Ноутбук',
    cpu,
    cpuScore: Math.round(firstNum(g('cpuScore')) ?? (cpu ? lookupScore(cpu) ?? 10000 : 10000)),
    gpu,
    gpuTier: clampNum(Math.round(firstNum(g('gpuTier')) ?? inferGpuTier(gpu)), 0, 5),
    ram: parseRam(g('ram')),
    storage: parseStorage(g('storage')),
    screenSize: parseScreenSize(g('screenSize')),
    resolution: parseResolution(g('resolution')),
    hz: parseHz(g('hz')),
    panel: parsePanel(g('panel')),
    weight: parseWeight(g('weight')),
    battery: parseBattery(g('battery')),
    price: parsePrice(g('price'), currency),
    year: clampNum(Math.round(firstNum(g('year')) ?? 2024), 2010, 2026),
    rating: clampNum(firstNum(g('rating')), 0, 5) || 4.2,
    os: clean(g('os')) || null,
    tags: [],
  };

  // Добор пропущенных полей из текста всей строки
  const combined = `${g('screenSize')} ${g('resolution')} ${g('hz')} ${g('panel')} ${text}`;
  if (!item.resolution) item.resolution = parseResolution(combined);
  if (!item.hz) item.hz = parseHz(combined);
  if (!item.panel) item.panel = parsePanel(combined);
  if (!item.ram) item.ram = parseRam(combined.match(/\b(\d{1,3})\s*gb\s*(?:ram|ddr)?\b/i)?.[0] ?? '');
  if (!item.storage) item.storage = parseStorage(combined.match(/\b\d+\s*(gb|tb)\s*(ssd|nvme|harddisk|disk)\b/i)?.[0] ?? '');

  // Осмысленность записи: хотя бы цена или процессор
  if (!item.price && !item.cpu) return null;
  return item;
}

/* ------------------------------------------------------------------ */
/* Загрузка CSV                                                        */
/* ------------------------------------------------------------------ */
async function readCsvText() {
  if (source) {
    if (/^https?:\/\//i.test(source)) {
      console.log(`↓ Скачиваю: ${source}`);
      const res = await axios.get(source, { responseType: 'text', timeout: 60000, maxRedirects: 5 });
      return res.data;
    }
    return fs.readFileSync(path.resolve(source), 'utf8');
  }
  // Ищем data/raw/*.csv
  if (!fs.existsSync(RAW_DIR)) {
    throw new Error('Нет файла: передайте путь к CSV или положите CSV в data/raw/');
  }
  const files = fs.readdirSync(RAW_DIR).filter((f) => f.toLowerCase().endsWith('.csv'));
  if (!files.length) throw new Error(`В ${RAW_DIR} нет CSV-файлов`);
  console.log(`↓ Найден ${files[0]} в data/raw/`);
  return fs.readFileSync(path.join(RAW_DIR, files[0]), 'utf8');
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */
async function main() {
  const text = await readCsvText();
  const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  if (!rows.length) throw new Error('Пустой CSV');

  const headers = Object.keys(rows[0]).map(norm);
  const map = {};
  for (const [field, candidates] of FIELDS) {
    const idx = headers.findIndex((h) => candidates.includes(h));
    if (idx !== -1) map[field] = Object.keys(rows[0])[idx];
  }
  const ctx = { map };

  const items = [];
  const seen = new Set();
  for (const row of rows) {
    const item = convertRow(row, ctx);
    if (!item) continue;
    let id = slug(`${item.brand}-${item.model}-${item.year || ''}`);
    while (seen.has(id)) id = `${id}-${items.length}`;
    seen.add(id);
    item.id = id;
    items.push(item);
  }

  if (!items.length) throw new Error('Не удалось распознать ни одной строки с брендом/моделью');
  items.sort((a, b) => a.price - b.price);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(OUT_FILE)) {
    fs.copyFileSync(OUT_FILE, OUT_FILE.replace('.json', '.backup.json'));
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(items, null, 2), 'utf8');

  console.log('────────────────────────────────────────');
  console.log(`✔ Готово. Записей: ${items.length} → ${OUT_FILE}`);
  console.log(`  По брендам: ${[...new Set(items.map((i) => i.brand))].length}`);
  const priced = items.filter((i) => i.price).length;
  console.log(`  С ценой: ${priced} / ${items.length}`);
  if (!priced) console.log('  ⚠ Колонку с ценой не найти — проверьте схему CSV.');
  console.log('────────────────────────────────────────');
}

main().catch((err) => {
  console.error(`✖ Ошибка импорта: ${err.message}`);
  process.exit(1);
});
