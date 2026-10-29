/**
 * Профили целей подбора: набор обязательных (must) и желательных (nice)
 * требований к железу. Значение требования превращается в фильтр:
 *
 *   - минимум: cpuScore, ram, storage, gpuTier, hz, battery, screenSize
 *   - максимум (значение — потолок): weight, price
 *   - точное совпадение: panel
 */

export const PROFILES = {
  gaming: {
    key: 'gaming',
    label: 'Игры',
    icon: 'fa-solid fa-gamepad',
    tag: 'игры',
    must: { gpuTier: 3, ram: 16, cpuScore: 14000, hz: 120 },
    nice: { cpuScore: 24000, battery: 5, weight: 2.6 },
    // На macOS игровые ограничены — Apple в «Игры» не попадает
    exclude: { os: 'macOS' },
  },
  study: {
    key: 'study',
    label: 'Учёба и офис',
    icon: 'fa-solid fa-graduation-cap',
    tag: 'офис',
    must: { cpuScore: 8000, ram: 8, price: 2440, weight: 2.1 },
    nice: { battery: 7, storage: 512, cpuScore: 12000 },
  },
  programming: {
    key: 'programming',
    label: 'Программирование',
    icon: 'fa-solid fa-code',
    tag: 'код',
    must: { cpuScore: 13000, ram: 16, storage: 512 },
    nice: { screenSize: 14, battery: 7, weight: 2.0, cpuScore: 20000 },
  },
  design: {
    key: 'design',
    label: 'Дизайн и видео',
    icon: 'fa-solid fa-palette',
    tag: 'дизайн',
    must: { cpuScore: 15000, ram: 16, gpuTier: 2, storage: 512 },
    nice: { panel: 'OLED', hz: 120, battery: 6, weight: 2.3 },
  },
  portable: {
    key: 'portable',
    label: 'Лёгкий и автономный',
    icon: 'fa-solid fa-feather',
    tag: 'лёгкий',
    must: { weight: 1.6, battery: 7 },
    nice: { cpuScore: 14000, ram: 16, weight: 1.3, battery: 12 },
  },
  budget: {
    key: 'budget',
    label: 'Бюджетный',
    icon: 'fa-solid fa-piggy-bank',
    tag: 'бюджет',
    must: { price: 1700 },
    nice: { cpuScore: 10000, ram: 16, storage: 512, battery: 7 },
  },
};

const MIN_KEYS = new Set(['cpuScore', 'ram', 'storage', 'gpuTier', 'hz', 'battery', 'screenSize']);
const MAX_KEYS = new Set(['weight', 'price']);
const EQ_KEYS = new Set(['panel']);

/** Проверяет один критерий: подходит ли ноутбук под значение требования. */
export function meetsCriterion(item, key, value) {
  const v = item[key];
  if (v === null || v === undefined || v === '') return false;
  if (EQ_KEYS.has(key)) return String(v).toLowerCase() === String(value).toLowerCase();
  const n = Number(v);
  if (Number.isNaN(n)) return false;
  if (MAX_KEYS.has(key)) return n <= value;
  if (MIN_KEYS.has(key)) return n >= value;
  return false;
}

/**
 * Подгонка ноутбука под цель.
 * Возвращает { key, label, pct } — процент соответствия, или null,
 * если ноутбук не проходит хотя бы по одному обязательному требованию
 * (или попал в exclude-исключение, напр. «не игры на macOS»).
 */
export function fitProfile(item, profileKey) {
  const profile = PROFILES[profileKey];
  if (!profile) return null;

  for (const [k, v] of Object.entries(profile.exclude || {})) {
    if (String(item[k] ?? '').toLowerCase() === String(v).toLowerCase()) return null;
  }

  const mustEntries = Object.entries(profile.must);
  const niceEntries = Object.entries(profile.nice);

  let mustMet = 0;
  let niceMet = 0;
  for (const [k, v] of mustEntries) if (meetsCriterion(item, k, v)) mustMet += 1;
  for (const [k, v] of niceEntries) if (meetsCriterion(item, k, v)) niceMet += 1;

  if (mustMet < mustEntries.length) return null;

  const pct = Math.round(
    (mustMet / mustEntries.length) * 60 + (niceMet / niceEntries.length) * 40,
  );
  return { key: profile.key, label: profile.label, icon: profile.icon, pct };
}

/** Все подходящие цели с процентами, отсортированные по убыванию соответствия. */
export function fitAll(item) {
  return Object.keys(PROFILES)
    .map((key) => fitProfile(item, key))
    .filter(Boolean)
    .sort((a, b) => b.pct - a.pct);
}
