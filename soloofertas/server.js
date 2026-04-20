require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(cors());
app.use(express.json());

const PAGES_DIR = path.join(__dirname, 'pages');
const HEADER_FRAGMENT = path.join(PAGES_DIR, 'shared', 'header.html');
const FOOTER_FRAGMENT = path.join(PAGES_DIR, 'shared', 'footer.html');

function readFragment(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; }
}

function injectFragments(html) {
  return html
    .replace('<div id="header-placeholder"></div>', readFragment(HEADER_FRAGMENT))
    .replace('<div id="footer-placeholder"></div>', readFragment(FOOTER_FRAGMENT));
}

function renderVacantes(region) {
  const file = path.join(PAGES_DIR, region, 'data', 'vacantes.json');
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return ''; }
  if (!Array.isArray(data) || data.length === 0) {
    return '<p class="vacantes-empty">No hay vacantes disponibles</p>';
  }
  const MIN_CELLS = 8;
  const esc = s => String(s).replace(/"/g, '&quot;');
  const items = data.map(v => (
    `<div class="vacante-item">` +
      `<img src="${esc(v.url)}" alt="Vacante" loading="lazy" ` +
      `onerror="this.onerror=null;this.src='/shared/img/placeholder.svg'">` +
    `</div>`
  )).join('');
  const empty = data.length < MIN_CELLS
    ? '<div class="vacante-item vacante-empty"></div>'.repeat(MIN_CELLS - data.length)
    : '';
  return items + empty;
}

function injectVacantes(html, region) {
  if (!region) return html;
  return html.replace('<!-- SSR:VACANTES -->', renderVacantes(region));
}

function renderPortadaUrl(region) {
  const file = path.join(PAGES_DIR, region, 'data', 'portada.json');
  try {
    const { url, version } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!url) return '/shared/img/placeholder.svg';
    return `${url}?v=${version || Date.now()}`;
  } catch (_) {
    return '/shared/img/placeholder.svg';
  }
}

function injectPortadas(html) {
  if (!html.includes('__SSR_PORTADA_')) return html;
  return html
    .replace('__SSR_PORTADA_GDL__', renderPortadaUrl('gdl'))
    .replace('__SSR_PORTADA_MTY__', renderPortadaUrl('mty'));
}

app.use((req, res, next) => {
  let urlPath = decodeURIComponent(req.path);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  if (!urlPath.endsWith('.html')) return next();

  const filePath = path.join(PAGES_DIR, urlPath);
  if (!filePath.startsWith(PAGES_DIR)) return next();

  const regionMatch = urlPath.match(/^\/(gdl|mty)\//);
  const region = regionMatch ? regionMatch[1] : null;

  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return next();
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(injectPortadas(injectVacantes(injectFragments(html), region)));
  });
});

app.use(express.static(PAGES_DIR));

// Routes
app.use('/soloofertas/auth', require('./routes/auth'));
app.use('/soloofertas/gdl', require('./routes/portada')('gdl'));
app.use('/soloofertas/mty', require('./routes/portada')('mty'));
app.use('/soloofertas/gdl', require('./routes/vacantes')('gdl'));
app.use('/soloofertas/mty', require('./routes/vacantes')('mty'));
app.use('/soloofertas/contacto', require('./routes/contacto'));

// Fallback 404 for unknown soloofertas routes
app.use('/soloofertas', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Solo Ofertas API corriendo en puerto ${PORT}`);
});
