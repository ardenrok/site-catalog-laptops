#!/usr/bin/env node
/**
 * Заполняет поле image (ссылка на фото модели) в data/laptops.json.
 *
 * Использование:
 *   npm run images                                   — авто: Wikimedia Commons → DuckDuckGo
 *   npm run images -- --source=commons               — только Commons (свободные лицензии)
 *   npm run images -- --source=ddg                   — только DDG (с домашней сети)
 *   npm run images -- --only macbook --limit 5       — фильтр по подстроке и числу запросов
 *   npm run images -- --from images.csv              — ручной режим: CSV «id,image» (без заголовка)
 *   npm run images -- --force                        — перезаполнить уже заполненные
 *
 * Ссылки хранятся в поле image; интерфейс сам рисует SVG-фолбэк,
 * если ссылка однажды отвалится.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'data', 'laptops.json');

const args = process.argv.slice(2);
// Поддержка и «--flag value», и «--flag=value»
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i !== -1) return args[i + 1] ?? true;
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(`--${name}=`.length);
  return undefined;
};
const has = (name) => args.indexOf(`--${name}`) !== -1;

const FORCE = has('force');
const ONLY = (arg('only') || '').toLowerCase();
const LIMIT = Number(arg('limit')) || Infinity;
const FROM = arg('from');
const SOURCES = String(arg('source') ?? 'commons,ddg').toLowerCase().split(',').filter(Boolean);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// фото-подавал сначала Commons: отсекаем не-изделия («батарейка», «мышкой» и т.п.)
const COMMONS_BAN = /battery|charger|adapter|pack|keyboard|mouse|headset|dock|stand|cover|skin|sticker|poster|logo/i;

/* ── Поисковый запрос по модели ───────────────────────────────────── */
function queryFor(item) {
  const core = item.model
    .replace(/[«»"'“”,()]/g, ' ')
    .replace(/\(\d{4}\)/g, ' ')
    .replace(/\d+(?:[.,]\d+)?\s*(?:″|in|"|')/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${item.brand} ${core}`;
}

/** «Ключевые» токены модели для проверки, что найденное фото о ней же. */
const STOP = new Set(['ноутбук', 'laptop', 'notebook']);
function keyTokens(item) {
  const t = `${item.brand} ${item.model}`
    .toLowerCase()
    .replace(/[«»"'“”,()]/g, ' ')
    .replace(/\d+(?:[.,]\d+)?\s*(?:″|in|")/gi, ' ')
    .replace(/[^a-z0-9а-я+ ]+/gi, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !STOP.has(w))
    .filter((w) => !(w.length <= 2 && /^\d+$/.test(w)))
    .filter((w) => !/^\d{4}$/.test(w));
  return [...new Set(t)];
}

/* ── Источник 1: Wikimedia Commons ────────────────────────────────── */
async function commonsGet(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await axios.get(url, { headers: { 'user-agent': UA }, timeout: 20000 });
    } catch (e) {
      const status = e.response?.status;
      if (status === 429 && attempt < 2) {
        console.log(`… commons: 429 (лимит), жду 20 c`);
        await sleep(20000);
        continue;
      }
      throw e;
    }
  }
}

async function commonsImage(item) {
  const query = encodeURIComponent(queryFor(item));
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&generator=search' +
    `&gsrsearch=${query}&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url` +
    '&iiurlwidth=640&format=json&origin=*';
  const res = await commonsGet(url);
  const pages = Object.values(res.data?.query?.pages || {})
    .filter((p) => !/^(w:|wikimedia commons|category:)/i.test(p.title || ''));
  if (!pages.length) throw new Error('commons: ничего не нашлось');

  // жёсткие токены (код модели/поколения: «m3», «e14», «fx507zc4») должны быть в названии;
  // мягкие (бренд, серия) — хотя бы половина
  const tokens = keyTokens(item);
  const hard = tokens.filter((w) => /\d/.test(w) && /[a-zа-я]/i.test(w));
  const soft = tokens.filter((w) => !hard.includes(w));
  const softNeed = soft.length <= 1 ? 2 : Math.ceil(soft.length / 2);

  let best = null;
  let bestScore = -1;
  for (const p of pages) {
    const t = p.title.toLowerCase();
    if (!/\.(jpe?g|png|webp)$/i.test(t)) continue;
    if (COMMONS_BAN.test(t)) continue;
    const hitHard =
      !hard.length || hard.every((h) => t.includes(h));
    if (!hitHard) continue;
    const softHits = soft.filter((s) => t.includes(s)).length;
    if (soft.length && softHits < softNeed) continue;
    const score = hard.length + softHits;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  if (!best) throw new Error('commons: нет уверенного совпадения');

  let u = best.imageinfo?.[0]?.thumburl || best.imageinfo?.[0]?.url || '';
  u = u.split('?utm_')[0];
  if (!u) throw new Error('commons: нет ссылки');
  return u;
}

/* ── Источник 2: DuckDuckGo images (с домашней сети) ──────────────── */
async function ddgImage(item) {
  const q = encodeURIComponent(queryFor(item));
  const page = await axios.get(`https://duckduckgo.com/?q=${q}&iax=images&ia=images`, {
    headers: { 'user-agent': UA },
    timeout: 20000,
    responseType: 'text',
  });
  const m = page.data.match(/vqd=([\d-]{10,})/);
  if (!m) throw new Error('ddg: не получили токен vqd');
  const vqd = m[1];

  const res = await axios.get(
    `https://duckduckgo.com/i.js?l=ru-ru&o=json&q=${q}&vqd=${vqd}&f=,,,&p=1`,
    {
      headers: {
        'user-agent': UA,
        referer: `https://duckduckgo.com/?q=${q}`,
        accept: 'application/json',
        'x-requested-with': 'XMLHttpRequest',
      },
      timeout: 20000,
      responseType: 'json',
    },
  );
  const results = (res.data.results || []).filter((r) => /\.(jpe?g|png|webp)$/i.test(r.image || ''));
  if (!results.length) throw new Error('ddg: нет результатов');
  return results[0].image;
}

const SOURCES_FN = { commons: commonsImage, ddg: ddgImage };

/* ── Ручной режим: CSV «id,image» ─────────────────────────────────── */
function applyFromCsv(csvPath) {
  const text = fs.readFileSync(path.resolve(csvPath), 'utf8');
  const items = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const map = new Map(items.map((i) => [i.id, i]));

  let applied = 0;
  for (const line of text.split(/\r?\n/)) {
    const [id, url] = line.split(',').map((s) => s.trim());
    if (!id || !url) continue;
    const item = map.get(id);
    if (!item) { console.warn(`⚠ нет такого id: ${id}`); continue; }
    item.image = url;
    applied++;
  }
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2), 'utf8');
  console.log(`✔ применено ссылок: ${applied}`);
}

/* ── Авто-режим ───────────────────────────────────────────────────── */
async function auto() {
  const items = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const sources = SOURCES.filter((s) => SOURCES_FN[s]);
  const targets = items.filter(
    (i) =>
      (FORCE || !i.image) &&
      (!ONLY || `${i.brand} ${i.model}`.toLowerCase().includes(ONLY)),
  ).slice(0, LIMIT);

  if (!targets.length) { console.log('Нечего искать (все заполнены или фильтр пуст)'); return; }
  console.log(`→ ищу картинки для ${targets.length} моделей (источники: ${sources.join(' → ')})`);

  let ok = 0, fail = 0;
  for (const item of targets) {
    let done = false;
    for (const src of sources) {
      try {
        const url = await SOURCES_FN[src](item);
        item.image = url;
        ok++;
        done = true;
        console.log(`✔ [${src}] ${item.brand} ${item.model}\n   ${url.slice(0, 110)}`);
        break;
      } catch (e) {
        if (src !== sources[sources.length - 1]) console.log(`… [${src}] ${item.model}: ${e.message}`);
        else {
          fail++;
          console.warn(`✖ ${item.brand} ${item.model} — ${e.message}`);
        }
      }
      await sleep(400);
    }
    await sleep(1800); // щадим Commons (без 429)
  }

  fs.writeFileSync(FILE, JSON.stringify(items, null, 2), 'utf8');
  console.log('──────────────────────────────────────');
  console.log(`✔ найдено: ${ok}  ✖ не найдено: ${fail}  из ${targets.length}`);
  console.log('  Не нашлось? Заполните images.csv (id,image) и запустите:');
  console.log('  npm run images -- --from images.csv');
}

if (FROM) applyFromCsv(FROM);
else auto().catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
