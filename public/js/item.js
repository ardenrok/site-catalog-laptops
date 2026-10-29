import { productVisual, formatPrice, formatScore, formatStorage, initTheme, esc, TAG_LABELS } from './lib.js';

const $ = (s) => document.querySelector(s);
const COLORS = ['#8b7cff', '#22d3ee', '#fbbf24'];

initTheme();

const params = new URLSearchParams(location.search);
const idsParam = (params.get('ids') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .slice(0, 3);
const single = params.get('id');

if (idsParam.length >= 2) {
  initCompare(idsParam);
} else if (single) {
  initDetail(single);
} else {
  showError('Не передан id ноутбука или список ids для сравнения.');
}

/* ═══════════════════════════ Карточка ═══════════════════════════ */
async function initDetail(id) {
  let item;
  try {
    const res = await fetch(`/api/laptops/${encodeURIComponent(id)}`);
    if (res.status === 404) throw new Error('Ноутбук не найден — возможно, каталог обновился.');
    if (!res.ok) throw new Error(`Ошибка сервера (${res.status})`);
    item = await res.json();
  } catch (e) {
    return showError(e.message);
  }

  document.title = `${item.brand} ${item.model} — IST`;

  $('#detail-visual').innerHTML = productVisual(item, 'h-[220px] w-auto max-w-full mx-auto object-contain');
  $('#detail-price').textContent = formatPrice(item.price || 0);
  $('#detail-rating').innerHTML = `<i class="fa-solid fa-star"></i> ${item.rating.toFixed(1)}`;
  $('#detail-brand').textContent = item.brand;
  $('#detail-title').textContent = item.model;

  $('#detail-meta').innerHTML = [
    `<span class="chip !cursor-default"><i class="fa-solid fa-calendar text-brand"></i> ${item.year}</span>`,
    `<span class="chip !cursor-default"><i class="fa-solid fa-globe text-brand"></i> ${esc(item.os || '—')}</span>`,
    ...(item.tags || []).map((t) => `<span class="tag tag--${t}">${TAG_LABELS[t] || t}</span>`),
  ].join('');

  const specs = [
    { icon: 'fa-microchip', label: 'Процессор', val: esc(item.cpu), sub: `${formatScore(item.cpuScore)} балл. (multi)` },
    { icon: 'fa-gauge-high', label: 'Видеокарта', val: esc(item.gpu), sub: `уровень ${item.gpuTier} из 5` },
    { icon: 'fa-memory', label: 'Память', val: `${item.ram} ГБ`, sub: 'ОЗУ' },
    { icon: 'fa-hard-drive', label: 'Накопитель', val: formatStorage(item.storage || 0), sub: 'SSD' },
    { icon: 'fa-display', label: 'Экран', val: `${item.screenSize}″ · ${esc(item.resolution || '—')}`, sub: `${item.hz} Гц · ${esc(item.panel || 'IPS')}` },
    { icon: 'fa-weight-scale', label: 'Вес', val: `${item.weight} кг`, sub: '' },
    { icon: 'fa-battery-full', label: 'Автономность', val: `${item.battery} ч`, sub: 'до работы без зарядки' },
  ];
  $('#detail-specs').innerHTML = specs
    .map(
      (s) => `
    <div class="flex items-start justify-between gap-3 border-b border-white/5 pb-3">
      <span class="flex shrink-0 items-center gap-2 text-[13px] text-soft">
        <i class="fa-solid ${s.icon} text-brand"></i>${s.label}
      </span>
      <span class="text-right">
        <b class="block text-sm text-strong">${s.val}</b>
        ${s.sub ? `<span class="text-[11px] text-dim">${s.sub}</span>` : ''}
      </span>
    </div>`,
    )
    .join('');

  $('#detail-fit').innerHTML = (item.fit || [])
    .map(
      (f) => `
    <div>
      <div class="mb-1.5 flex items-center justify-between text-sm">
        <span class="flex items-center gap-2 text-strong"><i class="${f.icon} text-brand"></i>${esc(f.label)}</span>
        <b class="text-accent">${f.pct}%</b>
      </div>
      <div class="fit-bar"><span data-w="${f.pct}"></span></div>
    </div>`,
    )
    .join('');

  // анимация полос
  requestAnimationFrame(() =>
    setTimeout(() => {
      $$('#detail-fit .fit-bar > span').forEach((s) => (s.style.width = `${s.dataset.w}%`));
    }, 60),
  );

  // кнопка сравнения
  const btn = $('#detail-compare');
  let compare = readCompare();
  const inList = compare.includes(item.id);
  if (inList) btn.innerHTML = '<i class="fa-solid fa-check"></i> В сравнении';
  btn.addEventListener('click', () => {
    compare = readCompare();
    if (compare.includes(item.id)) return;
    if (compare.length >= 3) {
      btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Максимум 3';
      setTimeout(() => (btn.innerHTML = '<i class="fa-solid fa-scale-balanced"></i> В сравнение'), 1800);
      return;
    }
    compare.push(item.id);
    localStorage.setItem('ist:compare', JSON.stringify(compare));
    btn.innerHTML = '<i class="fa-solid fa-check"></i> В сравнении';
    if (compare.length >= 2) {
      location.href = `/item.html?ids=${compare.map(encodeURIComponent).join(',')}`;
    }
  });

  $('#detail').classList.remove('hidden');
}

/* ═══════════════════════════ Сравнение ═══════════════════════════ */
async function initCompare(ids) {
  let items;
  try {
    const res = await fetch(`/api/laptops?ids=${ids.map(encodeURIComponent).join(',')}`);
    if (!res.ok) throw new Error(`Ошибка сервера (${res.status})`);
    ({ items } = await res.json());
  } catch (e) {
    return showError(e.message);
  }
  if (!items || items.length < 2) {
    return showError('Не удалось загрузить выбранные модели для сравнения.');
  }

  document.title = `Сравнение — IST`;
  $('#compare-cards').innerHTML = items
    .map(
      (item, ki) => `
    <div class="surface rounded-2xl p-4">
      <div class="card h-40" style="box-shadow:none">
        <div class="card-visual">${productVisual(item, 'h-[110px] w-auto max-w-[86%] object-contain')}</div>
      </div>
      <p class="mt-3 text-[11px] font-bold uppercase tracking-wider" style="color:${COLORS[ki % COLORS.length]}">${esc(item.brand)}</p>
      <p class="font-display text-sm font-bold leading-snug text-strong">${esc(item.model)}</p>
      <p class="mt-1 font-display text-lg font-extrabold text-strong">${formatPrice(item.price || 0)}</p>
    </div>`,
    )
    .join('');

  renderCompareTable(items);
  renderRadar(items);

  $('#compare').classList.remove('hidden');
}

function renderCompareTable(items) {
  const rows = [
    { label: 'Цена', text: (i) => formatPrice(i.price || 0), num: (i) => i.price || 0, best: 'min' },
    { label: 'Процессор', text: (i) => esc(i.cpu), num: (i) => i.cpuScore, best: 'max' },
    { label: 'CPU, баллы', text: (i) => formatScore(i.cpuScore), num: (i) => i.cpuScore, best: 'max' },
    { label: 'Видеокарта', text: (i) => esc(i.gpu), num: (i) => i.gpuTier, best: 'max' },
    { label: 'Уровень GPU', text: (i) => `${i.gpuTier} / 5`, num: (i) => i.gpuTier, best: 'max' },
    { label: 'ОЗУ', text: (i) => `${i.ram} ГБ`, num: (i) => i.ram, best: 'max' },
    { label: 'Накопитель', text: (i) => formatStorage(i.storage || 0), num: (i) => i.storage || 0, best: 'max' },
    { label: 'Экран', text: (i) => `${i.screenSize}″ ${esc(i.resolution || '')}`, num: null },
    { label: 'Частота', text: (i) => `${i.hz} Гц`, num: (i) => i.hz, best: 'max' },
    { label: 'Матрица', text: (i) => esc(i.panel || '—'), num: null },
    { label: 'Вес', text: (i) => `${i.weight} кг`, num: (i) => i.weight, best: 'min' },
    { label: 'Автономность', text: (i) => `${i.battery} ч`, num: (i) => i.battery, best: 'max' },
    { label: 'Год', text: (i) => i.year, num: (i) => i.year, best: 'max' },
    { label: 'Рейтинг', text: (i) => `${i.rating.toFixed(1)} ★`, num: (i) => i.rating, best: 'max' },
  ];

  const head = `
    <thead>
      <tr>
        <th class="w-36"></th>
        ${items
          .map(
            (i) =>
              `<th><span class="text-soft normal-case">${esc(i.brand)}</span><br><span class="normal-case tracking-normal text-strong">${esc(i.model)}</span></th>`,
          )
          .join('')}
      </tr>
    </thead>`;

  const body = rows
    .map((r) => {
      const nums = items.map((i) => (r.num ? r.num(i) : null));
      const bestVal =
        r.best && nums.every((n) => n !== null && n !== undefined)
          ? r.best === 'max'
            ? Math.max(...nums)
            : Math.min(...nums)
          : null;
      return `
      <tr>
        <td class="text-soft">${r.label}</td>
        ${items
          .map((i, ki) => {
            const isBest = bestVal !== null && r.num(i) === bestVal;
            return `<td class="${isBest ? 'best' : ''}">${r.text(i)}${isBest ? '<i class="fa-solid fa-trophy best-badge"></i>' : ''}</td>`;
          })
          .join('')}
      </tr>`;
    })
    .join('');

  $('#compare-table').innerHTML = `<table class="cmp-table min-w-[560px]">${head}<tbody>${body}</tbody></table>`;
}

function renderRadar(items) {
  if (typeof window.Chart === 'undefined') return;
  const clamp = (v) => Math.max(2, Math.min(100, Math.round(v)));

  const axes = [
    { label: 'CPU', f: (i) => clamp((i.cpuScore / 36000) * 100) },
    { label: 'GPU', f: (i) => clamp((i.gpuTier / 5) * 100) },
    { label: 'ОЗУ', f: (i) => clamp((i.ram / 32) * 100) },
    { label: 'Накопитель', f: (i) => clamp(((i.storage || 0) / 1024) * 100) },
    { label: 'Портативность', f: (i) => clamp(((3 - i.weight) / 2.2) * 100) },
    { label: 'Батарея', f: (i) => clamp((i.battery / 18) * 100) },
    { label: 'Рейтинг', f: (i) => clamp(((i.rating - 3.5) / 1.5) * 100) },
  ];

  new window.Chart($('#radar'), {
    type: 'radar',
    data: {
      labels: axes.map((a) => a.label),
      datasets: items.map((item, ki) => ({
        label: `${item.brand} ${item.model}`,
        data: axes.map((a) => a.f(item)),
        borderColor: COLORS[ki % COLORS.length],
        backgroundColor: `${COLORS[ki % COLORS.length]}2e`,
        pointBackgroundColor: COLORS[ki % COLORS.length],
        borderWidth: 2,
        pointRadius: 3,
      })),
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { family: 'Inter' } } },
        tooltip: { intersect: false },
      },
      scales: {
        r: {
          angleLines: { color: 'rgba(148,163,184,.2)' },
          grid: { color: 'rgba(148,163,184,.18)' },
          pointLabels: { color: '#94a3b8', font: { size: 11 } },
          ticks: { display: false, stepSize: 25 },
          suggestedMin: 0,
          suggestedMax: 100,
        },
      },
      elements: { line: { tension: 0.12 } },
    },
  });
}

/* ═══════════════════════════ Общее ═══════════════════════════ */
function readCompare() {
  try {
    return JSON.parse(localStorage.getItem('ist:compare') || '[]').filter(
      (v) => typeof v === 'string',
    );
  } catch {
    return [];
  }
}

function showError(msg) {
  $('#error-text').textContent = msg;
  $('#error').classList.remove('hidden');
}
