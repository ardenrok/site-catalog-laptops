import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './routes/api.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json());

// ---- API ----
app.use('/api', apiRouter);

// ---- Статика (index.html, item.html, css, js, img) ----
app.use(express.static(PUBLIC, { extensions: ['html'], maxAge: '1h' }));

// 404 для всего остального
app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC, '404.html'));
});

// error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] error:', err.message);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log('──────────────────────────────────────────────');
  console.log('  IST · каталог-фильтр ноутбуков запущен');
  console.log(`  Локально:  http://localhost:${PORT}`);
  console.log(`  API:       http://localhost:${PORT}/api/laptops`);
  console.log('──────────────────────────────────────────────');
});
