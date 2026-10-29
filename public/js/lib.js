/** Общие утилиты для каталожной и карточной страниц. */

/** Переключатель темы (иконки sun/moon, запоминаем выбор в localStorage). */
export function initTheme() {
  const save = localStorage.getItem('ist:theme');
  const dark = save !== 'light';
  document.documentElement.classList.toggle('dark', dark);
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const isDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('ist:theme', isDark ? 'dark' : 'light');
      paintIcons();
    });
  });
  paintIcons();
}

function paintIcons() {
  const dark = document.documentElement.classList.contains('dark');
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.innerHTML = `<i class="fa-solid ${dark ? 'fa-sun' : 'fa-moon'} text-[15px]"></i>`;
  });
}

export const formatPrice = (n) =>
  new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' Br';

/** Визуал товара: настоящая картинка (если есть) или сгенерированная SVG-иллюстрация. */
export function productVisual(item, cls = '') {
  if (item.image) {
    return `<img src="${esc(item.image)}" alt="${esc(item.brand)} ${esc(item.model)}"
      loading="lazy" decoding="async" class="${cls}"
      onerror="this.onerror=null;this.src='/img/laptop-fallback.svg'">`;
  }
  return laptopSVG(item);
}

export const formatScore = (n) =>
  new Intl.NumberFormat('ru-RU').format(n);

export function formatStorage(gb) {
  return gb >= 1024 ? `${(gb / 1024).toFixed(gb % 1024 ? 1 : 0)} ТБ` : `${gb} ГБ`;
}

/** Стабильный цвет по строке (для градиентов карточек). */
export function hashHue(str) {
  let h = 7;
  for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

/**
 * красоты-иллюстрация ноутбука (генерируется на клиенте — не зависит
 * от внешних картинок).
 */
export function laptopSVG(item) {
  const hue = hashHue(item.brand + (item.cpu || ''));
  const h1 = hue % 360;
  const h2 = (hue + 50) % 360;
  const id = `grad-${String(item.id || 'x').replace(/[^a-z0-9-]/gi, '')}`;
  const brand = String(item.brand || '').toUpperCase();
  return `
<svg viewBox="0 0 480 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(item.brand)} ${esc(item.model)}">
  <defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${h1},85%,60%)"/>
      <stop offset="1" stop-color="hsl(${h2},90%,55%)"/>
    </linearGradient>
  </defs>
  <ellipse cx="240" cy="238" rx="175" ry="16" fill="hsl(${h1},85%,60%)" opacity=".14"/>
  <rect x="88" y="36" width="304" height="200" rx="16" fill="hsl(223,32%,11%)"/>
  <rect x="85" y="33" width="310" height="200" rx="16" fill="none" stroke="hsl(223,18%,30%)" stroke-width="2"/>
  <rect x="102" y="50" width="276" height="172" rx="8" fill="url(#${id})"/>
  <rect x="102" y="50" width="276" height="172" rx="8" fill="hsl(222,40%,9%)" opacity=".52"/>
  <polygon points="102,50 214,50 150,222 102,222" fill="#ffffff" opacity=".07"/>
  <circle cx="240" cy="44" r="2" fill="hsl(220,20%,35%)"/>
  <path d="M62 240 L418 240 L436 272 Q438 278 430 278 L50 278 Q42 278 44 272 Z" fill="hsl(223,28%,17%)"/>
  <path d="M62 240 L418 240 L436 272 L44 272 Z" fill="none" stroke="hsl(223,18%,30%)" stroke-width="2"/>
  <rect x="196" y="266" width="88" height="7" rx="3.5" fill="hsl(223,14%,28%)"/>
  <g fill="hsl(223,16%,30%)" opacity=".65">
    ${keyboardRows()}
  </g>
  <text x="240" y="150" text-anchor="middle" font-family="Manrope, Inter, sans-serif"
        font-size="30" font-weight="800" letter-spacing="6" fill="#eef2ff" opacity=".92">${esc(brand)}</text>
</svg>`;
}

function keyboardRows() {
  const rows = [3, 5, 5, 5];
  const keys = [];
  rows.forEach((n, i) => {
    const y = 224 + i * 5;
    for (let k = 0; k < n; k++) {
      const w = 18;
      const x = 240 - (n * (w + 4) - 4) / 2 + k * (w + 4);
      keys.push(`<rect x="${x}" y="${y}" width="${w}" height="3" rx="1.5"/>`);
    }
  });
  return keys.join('');
}

/** Подписи тегов каталога. */
export const TAG_LABELS = {
  gaming: 'Игры',
  study: 'Офис',
  programming: 'Код',
  design: 'Дизайн',
  portable: 'Лёгкий',
  budget: 'Бюджет',
};

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
