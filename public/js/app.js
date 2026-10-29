import { productVisual, formatPrice, formatScore, formatStorage, initTheme, debounce, esc, TAG_LABELS } from './lib.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* Ключ группы чипов → поле состояния и параметр API */
const CHIP_KEYS = {
  ram: 'ramMin',
  storage: 'storageMin',
  screen: 'screenMin',
  weight: 'weightMax',
  battery: 'batteryMin',
  hz: 'hzMin',
  panel: 'panel',
};

const state = {
  purpose: null,
  search: '',
  brands: [],
  price: null, // [min, max]
  ramMin: null,
  storageMin: null,
  screenMin: null,
  weightMax: null,
  batteryMin: null,
  hzMin: null,
  panel: null,
  sort: null,
};

let FILTERS = null;
let slider = null;
let byIdCache = new Map();
let compare = [];
try {
  compare = JSON.parse(localStorage.getItem('ist:compare') || '[]').filter((v) => typeof v === 'string');
} catch { /* пусто */ }

initTheme();
boot();

/** Разовая инициализация не должна ронять остальные связки (слайдер ≠ живость фильтров). */
function safe(fn) {
  try {
    fn();
  } catch (e) {
    console.error('[IST] init:', e);
  }
}

async function boot() {
  try {
    FILTERS = await fetch('/api/filters').then((r) => r.json());
  } catch {
    $('#cards').innerHTML = `
      <div class="surface col-span-full rounded-2xl p-10 text-center">
        <p class="mb-3 text-3xl"><i class="fa-solid fa-plug-circle-exclamation text-brand"></i></p>
        <p class="font-display text-lg font-bold text-strong">Сервер не отвечает</p>
        <p class="mt-1 text-sm text-soft">Проверьте, что запущен <code>npm start</code>.</p>
      </div>`;
    return;
  }

  safe(renderPurposeTiles);
  safe(renderBrands);
  safe(initPriceSlider);
  safe(bindChips);
  safe(bindMisc);

  $('#cards').addEventListener('click', (e) => {
    const btn = e.target.closest('.compare-btn');
    if (btn) toggleCompare(btn.dataset.id);
  });
  $('#compare-bar').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) toggleCompare(rm.dataset.remove);
  });

  safe(renderCompareBar);
  safe(markCompareButtons);
  await load();
}

/* ── Плитки целей ─────────────────────────────────────────────────── */
function renderPurposeTiles() {
  const tiles = [
    { key: 'all', label: 'Все ноутбуки', icon: 'fa-solid fa-infinity', count: FILTERS.total },
    ...FILTERS.profiles,
  ];
  $('#purpose-tiles').innerHTML = tiles
    .map(
      (t) => `
    <button type="button" class="tile" data-purpose="${t.key}">
      <span class="tile-icon"><i class="${t.icon}"></i></span>
      <span class="tile-label">${esc(t.label)}</span>
      <span class="tile-count">${t.count} ${pluralModels(t.count)}</span>
    </button>`,
    )
    .join('');

  $('#purpose-tiles').addEventListener('click', (e) => {
    const btn = e.target.closest('.tile');
    if (!btn) return;
    const key = btn.dataset.purpose;
    state.purpose = key === 'all' || state.purpose === key ? null : key;

    paintTiles();
    paintSortUI();

    load();
    $('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function paintTiles() {
  const activeKey = state.purpose || 'all';
  $$('.tile').forEach((b) => b.classList.toggle('active', b.dataset.purpose === activeKey));
}

/* «Лучшее соответствие» осмысленно только с выбранной целью */
function paintSortUI() {
  const sel = $('#sort');
  if (state.purpose) {
    if (!state.sort || state.sort === 'match' || state.sort === 'rating') {
      state.sort = 'match';
      sel.value = 'match';
    }
  } else if (state.sort === 'match') {
    state.sort = null;
    sel.value = 'rating';
  }
}

const purposeLabel = (key) => FILTERS?.profiles?.find((p) => p.key === key)?.label ?? key;

function pluralModels(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'модель';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'модели';
  return 'моделей';
}

/* ── Бренды ───────────────────────────────────────────────────────── */
function renderBrands() {
  $('#brands').innerHTML = FILTERS.brands
    .map(
      (b) => `
    <label class="flex cursor-pointer items-center gap-2.5 select-none hover:text-white">
      <input type="checkbox" class="checkbox" value="${esc(b)}">
      <span>${esc(b)}</span>
    </label>`,
    )
    .join('');
  $('#brands').addEventListener('change', () => {
    state.brands = $$('#brands input:checked').map((i) => i.value);
    load();
  });
}

/* ── Ползунок цены ────────────────────────────────────────────────── */
function initPriceSlider() {
  const el = $('#price-slider');
  const { min, max } = FILTERS.price;
  try {
    if (typeof noUiSlider === 'undefined') throw new Error('noUiSlider не загрузился');
    noUiSlider.create(el, {
      start: [min, max],
      connect: true,
      step: 500,
      range: { min, max },
    });
    slider = el.noUiSlider;
    state.price = [min, max];
    paintPrice(min, max);

    let first = true;
    slider.on('update', (values) => {
      const v = values.map((x) => Math.round(Number(x)));
      state.price = v;
      paintPrice(v[0], v[1]);
      if (first) { first = false; return; }
      debounceLoad();
    });
  } catch (e) {
    console.warn('[IST] слайдер цены → числовой фолбэк:', e.message);
    initPriceFallback(min, max);
  }
}

/** Если noUiSlider недоступен — два числовых поля, фильтр всё равно работает. */
function initPriceFallback(min, max) {
  const box = $('#price-slider');
  box.innerHTML = `
    <div class="grid grid-cols-2 gap-2">
      <input id="price-min-fb" type="number" class="input" value="${min}" min="${min}" max="${max}" aria-label="Цена от">
      <input id="price-max-fb" type="number" class="input" value="${max}" min="${min}" max="${max}" aria-label="Цена до">
    </div>`;
  state.price = [min, max];
  paintPrice(min, max);

  const read = () => {
    let a = Number($('#price-min-fb').value);
    let b = Number($('#price-max-fb').value);
    if (!Number.isFinite(a)) a = min;
    if (!Number.isFinite(b)) b = max;
    if (a > b) [a, b] = [b, a];
    state.price = [a, b];
    paintPrice(a, b);
    debounceLoad();
  };
  $('#price-min-fb').addEventListener('input', read);
  $('#price-max-fb').addEventListener('input', read);
  box.dataset.fallback = '1';
}

function paintPrice(a, b) {
  $('#price-from').textContent = formatPrice(a);
  $('#price-to').textContent = formatPrice(b);
}

const debounceLoad = debounce(load, 300);

/* ── Чипы ─────────────────────────────────────────────────────────── */
function bindChips() {
  $$('.chips').forEach((group) => {
    group.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const key = CHIP_KEYS[group.dataset.key];
      const wasActive = chip.classList.contains('active');

      group.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      if (wasActive) state[key] = null;
      else {
        chip.classList.add('active');
        state[key] = chip.dataset.value;
      }
      load();
    });
  });
}

/* ── Прочие обработчики ───────────────────────────────────────────── */
function bindMisc() {
  $('#sort').addEventListener('change', () => {
    state.sort = $('#sort').value || null;
    load();
  });

  const onSearch = debounce((val) => {
    state.search = val.trim();
    load();
  }, 350);
  $('#search').addEventListener('input', (e) => {
    $('#search-mobile').value = e.target.value;
    onSearch(e.target.value);
  });
  $('#search-mobile').addEventListener('input', (e) => {
    $('#search').value = e.target.value;
    onSearch(e.target.value);
  });

  $('#reset-filters').addEventListener('click', resetAll);
  $('#empty-reset').addEventListener('click', resetAll);

  // мобильная выдвижная панель фильтров
  const panel = $('#filters');
  const overlay = $('#filters-overlay');
  const open = () => {
    panel.classList.remove('hidden', 'max-h-[calc(100vh-6rem)]', 'sticky', 'top-20');
    panel.classList.add('fixed', 'inset-y-0', 'left-0', 'z-50', 'w-[86%]', 'max-w-[320px]', 'max-h-none', 'overflow-y-auto');
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  };
  const close = () => {
    panel.classList.add('hidden', 'max-h-[calc(100vh-6rem)]', 'sticky', 'top-20');
    panel.classList.remove('fixed', 'inset-y-0', 'left-0', 'z-50', 'w-[86%]', 'max-w-[320px]', 'max-h-none');
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
  };
  $('#filters-open').addEventListener('click', open);
  $('#filters-close').addEventListener('click', close);
  overlay.addEventListener('click', close);
}

function resetAll() {
  Object.assign(state, {
    purpose: null, search: '', brands: [], ramMin: null, storageMin: null,
    screenMin: null, weightMax: null, batteryMin: null, hzMin: null, panel: null, sort: null,
  });
  priceToFilterBounds();
  $('#search').value = '';
  $('#search-mobile').value = '';
  $('#sort').value = 'rating';
  $$('#brands input:checked').forEach((i) => (i.checked = false));
  $$('.chip.active').forEach((c) => c.classList.remove('active'));
  paintTiles();
  load();
}

function priceToFilterBounds() {
  const { min, max } = FILTERS.price;
  state.price = [min, max];
  paintPrice(min, max);
  if (slider) slider.set(state.price);
  const fbMin = $('#price-min-fb');
  const fbMax = $('#price-max-fb');
  if (fbMin) fbMin.value = min;
  if (fbMax) fbMax.value = max;
}

/* ── Загрузка и отрисовка каталога ────────────────────────────────── */
async function load() {
  const target = $('#cards');
  const p = new URLSearchParams();

  if (state.purpose) p.set('purpose', state.purpose);
  if (state.search) p.set('search', state.search);
  if (state.sort) p.set('sort', state.sort);
  state.brands.forEach((b) => p.append('brand', b));
  if (state.price) {
    p.set('priceMin', state.price[0]);
    p.set('priceMax', state.price[1]);
  }
  for (const key of ['ramMin', 'storageMin', 'screenMin', 'weightMax', 'batteryMin', 'hzMin']) {
    if (state[key] !== null) p.set(key, state[key]);
  }
  if (state.panel) p.set('panel', state.panel);

  target.innerHTML = skeletonsHtml(9);
  $('#empty').classList.add('hidden');

  try {
    const data = await fetch(`/api/laptops?${p}`).then((r) => r.json());
    byIdCache = new Map(data.items.map((i) => [i.id, i]));

    $('#found').textContent = data.total;
    $('#found-purpose').textContent = state.purpose ? ` для цели «${purposeLabel(state.purpose)}»` : '';
    $('#empty').classList.toggle('hidden', data.total !== 0);
    target.innerHTML = data.items.map(cardHtml).join('');
  } catch {
    target.innerHTML = '';
    $('#empty').classList.remove('hidden');
  }
}

/* ── Шаблоны ──────────────────────────────────────────────────────── */
function cardHtml(item) {
  const tags = (item.tags || []).map((t) => `<span class="tag tag--${t}">${TAG_LABELS[t] || t}</span>`).join('');
  const bestFit = state.purpose
    ? `<span class="fit-badge"><i class="fa-solid fa-crosshairs"></i>${item.fitPct}%</span>`
    : '';
  const rating = `
    <span class="absolute right-3 top-3 z-[2] flex items-center gap-1 rounded-lg bg-slate-950/70 px-2 py-1 text-xs font-bold text-amber-300 backdrop-blur-sm">
      <i class="fa-solid fa-star text-[10px]"></i>${item.rating.toFixed(1)}
    </span>`;

  const lines = [
    { icon: 'fa-microchip', html: `<b>${esc(item.cpu)}</b><span>· ${formatScore(item.cpuScore)} балл.</span>` },
    { icon: 'fa-gauge-high', html: `<b>${esc(item.gpu)}</b>` },
    { icon: 'fa-memory', html: `<b>${item.ram} ГБ</b> RAM · ${formatStorage(item.storage)} SSD` },
    { icon: 'fa-display', html: `<b>${item.screenSize}″ ${esc(item.resolution || '')}</b>· ${item.hz} Гц · ${esc(item.panel || 'IPS')}` },
    { icon: 'fa-weight-scale', html: `<b>${item.weight} кг</b> · до ${item.battery} ч без зарядки` },
  ]
    .map((l) => `<p class="spec-line"><i class="fa-solid ${l.icon}"></i>${l.html}</p>`)
    .join('');

  return `
  <article class="card">
    <div class="card-visual">
      ${productVisual(item, 'h-[120px] w-auto max-w-[86%] object-contain')}
    </div>
    <div class="absolute left-3 top-3 z-[2] flex max-w-[80%] flex-wrap gap-1.5">${tags}</div>
    ${rating}
    ${bestFit}
    <div class="flex flex-1 flex-col gap-3 p-4">
      <div class="min-w-0">
        <p class="text-[11px] font-bold uppercase tracking-wider text-soft">${esc(item.brand)}</p>
        <h3 class="mt-0.5 line-clamp-2 font-display text-[15px] font-bold leading-snug text-strong">
          <a class="transition hover:text-brand" href="/item.html?id=${encodeURIComponent(item.id)}">${esc(item.model)}</a>
        </h3>
      </div>
      <div class="space-y-1.5">${lines}</div>
      <div class="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
        <p class="font-display text-lg font-extrabold text-strong">${formatPrice(item.price)}</p>
        <div class="flex gap-1.5">
          <a class="button button-primary !px-3" href="/item.html?id=${encodeURIComponent(item.id)}">Подробнее</a>
          <button type="button" class="button compare-btn" data-id="${item.id}" title="Добавить в сравнение" aria-pressed="false">
            <i class="fa-solid fa-scale-balanced"></i>
          </button>
        </div>
      </div>
    </div>
  </article>`;
}

function skeletonsHtml(n) {
  return Array.from({ length: n }, () => `
    <article class="card" aria-hidden="true">
      <div class="skeleton h-[168px] rounded-none"></div>
      <div class="space-y-2.5 p-4">
        <div class="skeleton h-3 w-16"></div>
        <div class="skeleton h-4 w-4/5"></div>
        <div class="skeleton h-3 w-1/2"></div>
        <div class="skeleton h-3 w-2/3"></div>
        <div class="skeleton h-3 w-3/5"></div>
        <div class="mt-5 flex items-center justify-between">
          <div class="skeleton h-6 w-24"></div>
          <div class="skeleton h-9 w-28"></div>
        </div>
      </div>
    </article>`).join('');
}

/* ── Сравнение ────────────────────────────────────────────────────── */
function toggleCompare(id) {
  const i = compare.indexOf(id);
  if (i > -1) compare.splice(i, 1);
  else {
    if (compare.length >= 3) {
      shakeBar();
      return;
    }
    compare.push(id);
  }
  localStorage.setItem('ist:compare', JSON.stringify(compare));
  renderCompareBar();
  markCompareButtons();
}

function markCompareButtons() {
  $$('.compare-btn').forEach((b) => {
    const on = compare.includes(b.dataset.id);
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function renderCompareBar() {
  const bar = $('#compare-bar');
  const go = $('#compare-go');
  if (!compare.length) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');

  $('#compare-list').innerHTML = compare
    .map((id) => {
      const it = byIdCache.get(id);
      const name = it ? `${esc(it.brand)} ${esc(it.model)}` : esc(id);
      return `
      <span class="chip flex max-w-full items-center gap-1.5 !cursor-default !py-1 text-xs">
        <span class="min-w-0 truncate">${name}</span>
        <button type="button" data-remove="${id}" class="text-dim transition hover:text-white" aria-label="Убрать из сравнения">
          <i class="fa-solid fa-xmark pointer-events-none"></i>
        </button>
      </span>`;
    })
    .join('');

  const ready = compare.length >= 2;
  go.style.pointerEvents = ready ? '' : 'none';
  go.style.opacity = ready ? '' : '0.5';
  go.href = ready ? `/item.html?ids=${compare.map(encodeURIComponent).join(',')}` : '#';
  go.textContent = ready
    ? `Сравнить (${compare.length})`
    : `Добавьте ещё ${3 - compare.length}`;
}

function shakeBar() {
  $('#compare-bar').animate(
    [
      { transform: 'translate(-50%, 0)' },
      { transform: 'translate(-50%, -7px)' },
      { transform: 'translate(-50%, 0)' },
    ],
    { duration: 260, easing: 'ease-out' },
  );
}
