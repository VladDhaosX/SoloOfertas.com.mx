const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { PAGES_DIR, REGIONS, dataPath, uploadsPath, assertContentReady } = require('./content-paths');
const { readJson, readJsonArray } = require('./content-store');

assertContentReady();

const app = express();

app.use(cors());
app.use(express.json());

function validateContentHealth() {
  for (const region of REGIONS) {
    const portada = readJson(dataPath(region, 'portada.json'));
    if (!portada || typeof portada.url !== 'string' || !portada.url) {
      throw new TypeError(`portada.json invalido para ${region}`);
    }
    readJsonArray(dataPath(region, 'vacantes.json'));
  }
  readJsonArray(dataPath('gdl', 'cupones.json'));
}

app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    validateContentHealth();
    res.json({
      status: 'ok',
      content: 'ready',
      uptimeSeconds: Math.floor(process.uptime()),
      release: process.env.DEPLOY_COMMIT || null,
    });
  } catch (_) {
    res.status(503).json({ status: 'error', content: 'unavailable' });
  }
});

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
  const file = dataPath(region, 'vacantes.json');
  let data;
  try {
    data = readJsonArray(file);
  } catch (err) {
    console.error(`vacantes read error (${region}):`, err);
    return '<p class="vacantes-empty">Contenido temporalmente no disponible</p>';
  }
  if (!Array.isArray(data) || data.length === 0) {
    return '<p class="vacantes-empty">No hay ofertas disponibles</p>';
  }
  const MIN_CELLS = 8;
  const esc = s => String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const waHref = telefono => {
    let digits = String(telefono || '').replace(/\D/g, '');
    if (digits.length === 10) digits = `52${digits}`;
    return digits ? `https://wa.me/${digits}` : '';
  };
  const items = data.map(v => {
    const rot = v.rotation ? ` style="transform:rotate(${Number(v.rotation)}deg)"` : '';
    const whatsappUrl = waHref(v.telefono);
    const contact = whatsappUrl
      ? `<a class="vacante-whatsapp" href="${esc(whatsappUrl)}" target="_blank" rel="noopener" aria-label="Contactanos por WhatsApp" data-tooltip="Contactanos">` +
          `<img src="/shared/img/whatsapp.svg" alt="" aria-hidden="true">` +
        `</a>`
      : '';
    return `<div class="vacante-item">` +
      `<img src="${esc(v.url)}" data-full-src="${esc(v.url)}" alt="Oferta" loading="lazy" decoding="async"${rot} ` +
      `onerror="this.onerror=null;this.src='/shared/img/placeholder.svg'">` +
      contact +
    `</div>`;
  }).join('');
  const empty = data.length < MIN_CELLS
    ? '<div class="vacante-item vacante-empty"></div>'.repeat(MIN_CELLS - data.length)
    : '';
  return items + empty;
}

function injectVacantes(html, region) {
  if (!region) return html;
  return html.replace('<!-- SSR:VACANTES -->', renderVacantes(region));
}

function renderCupones() {
  let data;
  try {
    data = readJsonArray(dataPath('gdl', 'cupones.json'));
  } catch (err) {
    console.error('cupones read error (gdl):', err);
    return '<p class="vacantes-empty">Contenido temporalmente no disponible</p>';
  }
  if (!Array.isArray(data) || data.length === 0) {
    return '<p class="vacantes-empty">No hay cupones disponibles</p>';
  }
  const esc = s => String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return data.map(item => {
    const rot = item.rotation ? ` style="transform:rotate(${Number(item.rotation)}deg)"` : '';
    return `<div class="vacante-item" data-cupon>` +
      `<img src="${esc(item.url)}" data-full-src="${esc(item.url)}" alt="Cupón en Guadalajara" loading="lazy" decoding="async"${rot} ` +
      `onerror="this.onerror=null;this.src='/shared/img/placeholder.svg'">` +
    `</div>`;
  }).join('');
}

function injectCupones(html, region) {
  if (region !== 'gdl') return html;
  return html.replace('<!-- SSR:CUPONES -->', renderCupones());
}

function renderPortadaUrl(region) {
  const file = dataPath(region, 'portada.json');
  try {
    const { url, version } = readJson(file);
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
    res.send(injectPortadas(injectCupones(injectVacantes(injectFragments(html), region), region)));
  });
});

for (const region of REGIONS) {
  app.use(`/${region}/data`, express.static(path.dirname(dataPath(region, 'placeholder.json'))));
  app.use(`/${region}/uploads/vacantes`, express.static(uploadsPath(region, 'vacantes')));
  app.use(`/${region}/uploads/portadas`, express.static(uploadsPath(region, 'portadas')));
}
app.use('/gdl/uploads/cupones', express.static(uploadsPath('gdl', 'cupones')));
app.use(express.static(PAGES_DIR));

// Routes
app.use('/soloofertas/auth', require('./routes/auth'));
app.use('/soloofertas/gdl', require('./routes/portada')('gdl'));
app.use('/soloofertas/mty', require('./routes/portada')('mty'));
app.use('/soloofertas/gdl', require('./routes/vacantes')('gdl'));
app.use('/soloofertas/mty', require('./routes/vacantes')('mty'));
app.use('/soloofertas/gdl', require('./routes/cupones')('gdl'));
app.use('/soloofertas/contacto', require('./routes/contacto'));

// Fallback 404 for unknown soloofertas routes
app.use('/soloofertas', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Region redirects — any unresolved /gdl* or /mty* goes to its actual page
app.use('/gdl', (req, res) => res.redirect('/gdl/inicio/'));
app.use('/mty', (req, res) => res.redirect('/mty/inicio/'));

// Catch-all — everything else back to homepage (guard: skip if already at /)
app.use((req, res) => {
  if (req.path === '/') return res.status(404).end();
  res.redirect('/');
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Solo Ofertas API corriendo en puerto ${PORT}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} recibido; cerrando servidor...`);

  const timeout = setTimeout(() => {
    console.error('Cierre forzado despues de 10 segundos');
    process.exit(1);
  }, 10000);
  timeout.unref();

  server.close(err => {
    clearTimeout(timeout);
    if (err) {
      console.error('Error al cerrar servidor:', err);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
