import { Router } from 'express';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILES, fitProfile, fitAll } from '../lib/profiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(__dirname, '..', 'data', 'laptops.json');

const router = Router();
let cache = null;
let cacheStamp = 0;

/** Читает каталог с диска; кэш сбрасывается при обновлении файла (import-скриптом). */
async function loadLaptops() {
  try {
    const stamp = (await stat(DATA_FILE)).mtimeMs;
    if (!cache || stamp !== cacheStamp) {
      cache = JSON.parse(await readFile(DATA_FILE, 'utf8'));
      cacheStamp = stamp;
    }
  } catch {
    cache = cache || [];
  }
  return cache;
}

function str(v) {
  return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
}

function num(v) {
  const s = str(v).trim();
  if (!s) return null; // отсутствие параметра ≠ 0
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function arr(v) {
  return [].concat(v ?? []);
}

/* ------------------------------------------------------------------ */
/* GET /api/profiles — описания целей (для документации/фронтенда)      */
/* ------------------------------------------------------------------ */
router.get('/profiles', (req, res) => {
  res.json(
    Object.values(PROFILES).map(({ key, label, icon, tag, must, nice }) => ({
      key,
      label,
      icon,
      tag,
      must,
      nice,
    })),
  );
});

/* ------------------------------------------------------------------ */
/* GET /api/filters — списки для фильтров + счётчики по целям           */
/* ------------------------------------------------------------------ */
router.get('/filters', async (req, res, next) => {
  try {
    const items = await loadLaptops();
    const prices = items.map((i) => i.price).filter(Boolean);

    const profiles = Object.keys(PROFILES).map((key) => ({
      key,
      label: PROFILES[key].label,
      icon: PROFILES[key].icon,
      count: items.filter((i) => fitProfile(i, key)).length,
    }));

    res.json({
      total: items.length,
      brands: [...new Set(items.map((i) => i.brand))].sort((a, b) =>
        a.localeCompare(b, 'ru'),
      ),
      price: {
        min: prices.length ? Math.min(...prices) : 0,
        max: prices.length ? Math.max(...prices) : 0,
      },
      rams: [...new Set(items.map((i) => i.ram))].filter(Boolean).sort((a, b) => a - b),
      storages: [...new Set(items.map((i) => i.storage))].filter(Boolean).sort((a, b) => a - b),
      screens: [...new Set(items.map((i) => i.screenSize))].filter(Boolean).sort((a, b) => a - b),
      panels: [...new Set(items.map((i) => i.panel))].filter(Boolean),
      hz: [...new Set(items.map((i) => i.hz))].filter(Boolean).sort((a, b) => a - b),
      years: [...new Set(items.map((i) => i.year))].filter(Boolean).sort((a, b) => b - a),
      profiles,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/laptops — каталог с фильтрами, поиском и сортировкой        */
/* ------------------------------------------------------------------ */
router.get('/laptops', async (req, res, next) => {
  try {
    const items = await loadLaptops();

    // Сравнение: ?ids=a,b,c — вернуть записи в заданном порядке
    const ids = arr(req.query.ids)
      .flatMap((s) => String(s).split(','))
      .filter(Boolean);
    if (ids.length) {
      const map = new Map(items.map((i) => [i.id, i]));
      const picked = ids.map((id) => map.get(id)).filter(Boolean);
      return res.json({ total: picked.length, items: picked });
    }

    const search = str(req.query.search).trim().toLowerCase();
    const purpose = str(req.query.purpose);
    const brandList = arr(req.query.brand).map((b) => String(b).toLowerCase());
    const priceMin = num(req.query.priceMin);
    const priceMax = num(req.query.priceMax);
    const ramMin = num(req.query.ramMin);
    const ramMax = num(req.query.ramMax);
    const storageMin = num(req.query.storageMin);
    const screenMin = num(req.query.screenMin);
    const screenMax = num(req.query.screenMax);
    const weightMax = num(req.query.weightMax);
    const batteryMin = num(req.query.batteryMin);
    const hzMin = num(req.query.hzMin);
    const panel = str(req.query.panel);

    let list = items.filter((item) => {
      if (
        search &&
        !`${item.brand} ${item.model} ${item.cpu} ${item.gpu}`
          .toLowerCase()
          .includes(search)
      ) {
        return false;
      }
      if (brandList.length && !brandList.includes(String(item.brand).toLowerCase())) return false;
      if (priceMin !== null && item.price < priceMin) return false;
      if (priceMax !== null && item.price > priceMax) return false;
      if (ramMin !== null && item.ram < ramMin) return false;
      if (ramMax !== null && item.ram > ramMax) return false;
      if (storageMin !== null && item.storage < storageMin) return false;
      if (item.screenSize !== null && item.screenSize !== undefined) {
        if (screenMin !== null && item.screenSize < screenMin) return false;
        if (screenMax !== null && item.screenSize > screenMax) return false;
      }
      if (weightMax !== null && item.weight !== null && item.weight > weightMax) return false;
      if (batteryMin !== null && item.battery !== null && item.battery < batteryMin) return false;
      if (hzMin !== null && item.hz !== null && item.hz < hzMin) return false;
      if (panel && String(item.panel || '').toLowerCase() !== panel.toLowerCase()) return false;
      return true;
    });

    // Цель: оставляем только проходящие по обязательным требованиям и считаем %
    let hasPurpose = false;
    if (purpose && PROFILES[purpose]) {
      hasPurpose = true;
      list = list
        .map((item) => ({
          ...item,
          fitPct: fitProfile(item, purpose)?.pct ?? null,
        }))
        .filter((item) => item.fitPct !== null);
    }

    // Всегда прикладываем список подходящих целей (для чипов на карточке)
    list = list.map(({ fitPct, ...item }) => ({ ...item, fit: fitAll(item), ...(fitPct ? { fitPct } : {}) }));

    const sort = str(req.query.sort) || (hasPurpose ? 'match' : 'rating');
    const sorters = {
      match: (a, b) => b.fitPct - a.fitPct || b.rating - a.rating,
      rating: (a, b) => b.rating - a.rating || a.price - b.price,
      price_asc: (a, b) => a.price - b.price,
      price_desc: (a, b) => b.price - a.price,
      new: (a, b) => b.year - a.year || b.rating - a.rating,
    };
    list.sort(sorters[sort] || sorters.rating);

    const limit = Math.min(num(req.query.limit) || 500, 500);
    res.json({
      total: list.length,
      purpose: hasPurpose ? purpose : null,
      sort,
      items: list.slice(0, limit),
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/laptops/:id — карточка с процентами по всем целям           */
/* ------------------------------------------------------------------ */
router.get('/laptops/:id', async (req, res, next) => {
  try {
    const items = await loadLaptops();
    const item = items.find((i) => i.id === req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Ноутбук не найден' });
    }
    res.json({ ...item, fit: fitAll(item) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/health                                                     */
/* ------------------------------------------------------------------ */
router.get('/health', async (req, res, next) => {
  try {
    const items = await loadLaptops();
    res.json({ ok: true, laptops: items.length });
  } catch (err) {
    next(err);
  }
});

export default router;
