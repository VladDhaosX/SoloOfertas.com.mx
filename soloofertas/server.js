const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const fs = require('fs');
const { randomUUID } = require('crypto');
const {
  PAGES_DIR,
  REGIONS,
  dataPath,
  uploadsPath,
  assertContentConfigured,
  assertContentReady,
} = require('./content-paths');
const { readJson, readJsonArray } = require('./content-store');
const { maintenanceOperation } = require('./maintenance-state');
const site = require('./site-config');

const INSTANCE_ID = randomUUID();
const STARTED_AT = new Date().toISOString();
const SCANNER_CACHE_CONTROL = 'public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400';
const SCANNER_PATH_PATTERNS = [
  /^\/wp-admin(?:\/|$)/i,
  /^\/wp-content(?:\/|$)/i,
  /^\/wp-includes(?:\/|$)/i,
  /^\/wp-json(?:\/|$)/i,
  /^\/wp-login\.php$/i,
  /^\/xmlrpc\.php$/i,
];
const PUBLIC_PAGE_PATHS = new Set([
  '/',
  '/gdl/inicio/',
  '/mty/inicio/',
  '/gdl/guia-ofertas/',
  '/mty/guia-ofertas/',
  '/gdl/contacto/',
  '/mty/contacto/',
]);
const PUBLIC_PAGE_SLUGS = new Set(['inicio', 'guia-ofertas', 'contacto']);

function isPublicRegionPage(region, slug) {
  return REGIONS.includes(region) && PUBLIC_PAGE_SLUGS.has(slug);
}

function canonicalPublicPath(pathname) {
  const value = String(pathname || '/').replace(/\/{2,}/g, '/');
  const lowered = value.toLowerCase();
  if (lowered === '/' || lowered === '/index.html') return '/';

  const regionRoot = lowered.match(/^\/(gdl|mty)\/?(?:index\.html)?$/);
  if (regionRoot) return `/${regionRoot[1]}/inicio/`;

  const nested = lowered.match(/^\/(gdl|mty)\/(gdl|mty)(?:\/([^/]+))?\/?(?:index\.html)?$/);
  if (nested && isPublicRegionPage(nested[2], nested[3] || 'inicio')) {
    return `/${nested[2]}/${nested[3] || 'inicio'}/`;
  }

  const page = lowered.match(/^\/(gdl|mty)\/([^/]+)\/?(?:index\.html)?$/);
  if (page && isPublicRegionPage(page[1], page[2])) return `/${page[1]}/${page[2]}/`;

  const offer = lowered.match(/^\/(gdl|mty)\/ofertas\/([a-z0-9_-]+)\/?(?:index\.html)?$/);
  if (offer) return `/${offer[1]}/ofertas/${offer[2]}/`;
  return PUBLIC_PAGE_PATHS.has(lowered) ? lowered : null;
}

function redirectUrl(req, canonicalPath) {
  const url = new URL(req.originalUrl, 'http://local');
  url.searchParams.delete('custom-css');
  const query = url.searchParams.toString();
  return `${canonicalPath}${query ? `?${query}` : ''}`;
}

function setPageAssetHeaders(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.xml' || ext === '.txt') {
    res.setHeader('Cache-Control', 'public, max-age=300');
  } else if (['.css', '.js', '.svg', '.ico'].includes(ext)) {
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
  } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    res.setHeader('Cache-Control', 'public, max-age=604800');
  }
}

function setUploadHeaders(res) {
  res.setHeader('Cache-Control', 'public, max-age=604800');
}

function setDataHeaders(res) {
  res.setHeader('Cache-Control', 'no-cache');
}

function memoryUsageMb() {
  const usage = process.memoryUsage();
  return {
    rss: Math.round(usage.rss / 1024 / 1024),
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
  };
}

function lifecycle(event, details = {}, level = 'info') {
  const record = {
    type: 'lifecycle',
    event,
    timestamp: new Date().toISOString(),
    instanceId: INSTANCE_ID,
    pid: process.pid,
    ppid: process.ppid,
    uptimeSeconds: Math.floor(process.uptime()),
    ...details,
  };
  const line = `${JSON.stringify(record)}\n`;

  try {
    fs.writeSync(level === 'error' ? 2 : 1, line);
  } catch (_) {
    // No dejamos que un problema del destino de logs oculte el evento original.
  }
}

function errorDetails(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

lifecycle('starting', {
  node: process.version,
  environment: process.env.NODE_ENV || 'development',
  cwd: process.cwd(),
  memoryMb: memoryUsageMb(),
});

try {
  assertContentReady();
} catch (err) {
  // Mantiene el proceso disponible para diagnostico y recuperacion. /health
  // continuara devolviendo 503 hasta que el volumen persistente este listo.
  console.error('Contenido no disponible al iniciar:', err.message);
}

const app = express();

app.use((req, res, next) => {
  res.set('X-App-Instance', INSTANCE_ID);
  next();
});
app.use((req, res, next) => {
  if (!SCANNER_PATH_PATTERNS.some(pattern => pattern.test(req.path))) return next();

  // El sitio no usa WordPress. Evita que escaneos automatizados lleguen al
  // catch-all, que antes los redirigia a la portada y duplicaba el trabajo.
  res.set('Cache-Control', SCANNER_CACHE_CONTROL);
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.status(404).end();
});
app.use(cors());
app.use(compression());
app.use(express.json());

app.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  const canonicalPath = canonicalPublicPath(req.path);
  const host = String(req.hostname || '').toLowerCase();
  const isWwwHost = host === `www.${site.publicHost}`;
  const hasJunkQuery = Object.prototype.hasOwnProperty.call(req.query, 'custom-css');

  if (isWwwHost) {
    const targetPath = redirectUrl(req, canonicalPath || req.path || '/');
    return res.redirect(301, `${site.publicOrigin}${targetPath}`);
  }
  if (canonicalPath && (canonicalPath !== req.path || hasJunkQuery)) {
    return res.redirect(301, redirectUrl(req, canonicalPath));
  }
  if (hasJunkQuery) return res.redirect(301, redirectUrl(req, req.path || '/'));
  next();
});

app.use(['/soloofertas/gdl', '/soloofertas/mty', '/soloofertas/backup'], (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  try {
    assertContentConfigured();
    const operation = maintenanceOperation();
    if (operation) {
      return res.status(503).json({ error: 'Contenido temporalmente bloqueado por mantenimiento' });
    }
    next();
  } catch (err) {
    console.error('Escritura bloqueada por configuracion de contenido:', err.message);
    res.status(503).json({ error: 'Almacenamiento persistente no disponible' });
  }
});

function validateContentHealth() {
  assertContentConfigured();
  for (const region of REGIONS) {
    const portada = readJson(dataPath(region, 'portada.json'));
    if (!portada || typeof portada.url !== 'string' || !portada.url) {
      throw new TypeError(`portada.json invalido para ${region}`);
    }
    readJsonArray(dataPath(region, 'vacantes.json'));
  }
  readJsonArray(dataPath('gdl', 'cupones.json'));
}

function livenessResponse() {
  return {
    status: 'ok',
    instanceId: INSTANCE_ID,
    startedAt: STARTED_AT,
    uptimeSeconds: Math.floor(process.uptime()),
    release: process.env.DEPLOY_COMMIT || null,
  };
}

// Liveness solo confirma que el proceso puede responder. No debe devolver 503
// por una dependencia recuperable o el supervisor puede provocar un reinicio.
app.get(['/health', '/health/live'], (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(livenessResponse());
});

// Readiness comprueba que el contenido administrable esta listo para servir.
app.get('/health/ready', (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    validateContentHealth();
    res.json({
      ...livenessResponse(),
      content: 'ready',
    });
  } catch (err) {
    console.error('Health check de contenido fallido:', err.message);
    res.status(503).json({
      ...livenessResponse(),
      status: 'unavailable',
      content: 'unavailable',
    });
  }
});

const HEADER_FRAGMENT = path.join(PAGES_DIR, 'shared', 'header.html');
const FOOTER_FRAGMENT = path.join(PAGES_DIR, 'shared', 'footer.html');
const NOT_FOUND_PAGE = path.join(PAGES_DIR, '404.html');
const OFFER_PAGE_TEMPLATE = path.join(__dirname, 'templates', 'oferta.html');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function newestDate(paths) {
  const times = paths.map(filePath => {
    try { return fs.statSync(filePath).mtimeMs; } catch (_) { return 0; }
  }).filter(Boolean);
  return new Date(times.length ? Math.max(...times) : Date.now()).toISOString().slice(0, 10);
}

function sitemapEntry(relativeUrl, priority, paths) {
  const lastmod = newestDate(paths);
  return `  <url>
    <loc>${escapeXml(`${site.publicOrigin}${relativeUrl}`)}</loc>
    <lastmod>${escapeXml(lastmod)}</lastmod>
    <priority>${priority}</priority>
  </url>`;
}

function validDateOnly(value) {
  const candidate = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return '';
  return Number.isNaN(Date.parse(`${candidate}T00:00:00Z`)) ? '' : candidate;
}

function readOffers(region, throwOnError = false) {
  try {
    return readJsonArray(dataPath(region, 'vacantes.json'));
  } catch (err) {
    if (throwOnError) throw err;
    console.error(`offers read error (${region}):`, err);
    return [];
  }
}

function offerPath(region, id) {
  return `/${region}/ofertas/${encodeURIComponent(String(id))}/`;
}

function renderSitemapXml() {
  const entries = [
    sitemapEntry('/', '1.0', [path.join(PAGES_DIR, 'index.html')]),
    sitemapEntry('/gdl/inicio/', '0.9', [
      path.join(PAGES_DIR, 'gdl', 'inicio', 'index.html'),
      dataPath('gdl', 'vacantes.json'),
      dataPath('gdl', 'portada.json'),
    ]),
    sitemapEntry('/mty/inicio/', '0.9', [
      path.join(PAGES_DIR, 'mty', 'inicio', 'index.html'),
      dataPath('mty', 'vacantes.json'),
      dataPath('mty', 'portada.json'),
    ]),
    sitemapEntry('/gdl/guia-ofertas/', '0.7', [path.join(PAGES_DIR, 'gdl', 'guia-ofertas', 'index.html')]),
    sitemapEntry('/mty/guia-ofertas/', '0.7', [path.join(PAGES_DIR, 'mty', 'guia-ofertas', 'index.html')]),
    sitemapEntry('/gdl/contacto/', '0.7', [path.join(PAGES_DIR, 'gdl', 'contacto', 'index.html')]),
    sitemapEntry('/mty/contacto/', '0.7', [path.join(PAGES_DIR, 'mty', 'contacto', 'index.html')]),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
}

function readImageDimensions(filePath) {
  let fd = null;
  try {
    const stat = fs.statSync(filePath);
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(Math.min(stat.size, 64 * 1024));
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const data = buffer.subarray(0, bytesRead);
    if (data.length >= 24 && data.toString('ascii', 1, 4) === 'PNG') {
      return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    }
    if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < data.length) {
        if (data[offset] !== 0xff) break;
        const marker = data[offset + 1];
        const length = data.readUInt16BE(offset + 2);
        if (length < 2) break;
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
        }
        offset += 2 + length;
      }
    }
  } catch (_) {
    return null;
  } finally {
    try { if (fd !== null) fs.closeSync(fd); } catch (_) {}
  }
  return null;
}

function imageDimensionAttrs(filePath) {
  const dimensions = readImageDimensions(filePath);
  return dimensions ? ` width="${dimensions.width}" height="${dimensions.height}"` : '';
}

function readFragment(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; }
}

function adjustFragmentForRegion(fragment, region, activePage) {
  if (!region) return fragment;
  return fragment.replace(/<a\b[^>]*>/g, tag => {
    let updated = tag;
    const regionHref = updated.match(/data-region-href="([^"]*)"/);
    if (regionHref) {
      const adjusted = regionHref[1].replace(/\/(gdl|mty)\//g, `/${region}/`);
      updated = updated.replace(/href="[^"]*"/, `href="${adjusted}"`);
    }
    if (updated.includes('data-region-empleos=')) {
      updated = updated.replace(/href="[^"]*"/, `href="${site.siblingOrigin}/${region}/inicio/"`);
      updated = updated.replace(/data-region-empleos="(?:gdl|mty)"/, `data-region-empleos="${region}"`);
    }
    const regionLink = updated.match(/data-region-link="([^"]*)"/);
    if (regionLink) {
      updated = updated.replace(/\sclass="active"/, '');
      if (regionLink[1] === region) {
        updated = updated.includes(' class=')
          ? updated.replace(/class="([^"]*)"/, (_, classes) => `class="${classes} active"`)
          : updated.replace('<a ', '<a class="active" ');
      }
    }
    const page = updated.match(/data-page="([^"]*)"/);
    if (page) {
      updated = updated.replace(/\sclass="active"/, '');
      if (page[1] === activePage) {
        updated = updated.includes(' class=')
          ? updated.replace(/class="([^"]*)"/, (_, classes) => `class="${classes} active"`)
          : updated.replace('<a ', '<a class="active" ');
      }
    }
    return updated;
  });
}

function injectFragments(html, region, activePage) {
  return html
    .replace(
      '<div id="header-placeholder"></div>',
      adjustFragmentForRegion(readFragment(HEADER_FRAGMENT), region, activePage)
    )
    .replace(
      '<div id="footer-placeholder"></div>',
      adjustFragmentForRegion(readFragment(FOOTER_FRAGMENT), region, activePage)
    );
}

function optimizedMediaUrl(region, type, rawUrl, preset) {
  const filename = encodeURIComponent(path.basename(String(rawUrl || '')));
  return filename ? `/media/${region}/${type}/${filename}?preset=${preset}` : '/shared/img/placeholder.svg';
}

function responsiveImageAttrs(region, type, rawUrl) {
  const smallUrl = optimizedMediaUrl(region, type, rawUrl, 'small');
  const thumbUrl = optimizedMediaUrl(region, type, rawUrl, 'thumb');
  return ` srcset="${escapeHtml(smallUrl)} 360w, ${escapeHtml(thumbUrl)} 640w"` +
    ` sizes="(max-width: 600px) calc(100vw - 2rem), (max-width: 900px) calc(50vw - 2rem), 390px"`;
}

function renderVacantes(region) {
  let data;
  try {
    data = readOffers(region, true);
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
  const items = data.map((v, index) => {
    const filename = path.basename(String(v.url || ''));
    const rotation = Number(v.rotation);
    const rot = Number.isFinite(rotation) && rotation !== 0
      ? ` style="transform:rotate(${rotation}deg)"`
      : '';
    const whatsappUrl = waHref(v.telefono);
    const sourcePath = uploadsPath(region, 'vacantes', filename);
    const thumbUrl = optimizedMediaUrl(region, 'vacantes', v.url, 'thumb');
    const fullUrl = optimizedMediaUrl(region, 'vacantes', v.url, 'full');
    const regionName = region === 'gdl' ? 'Guadalajara' : 'Monterrey';
    const contact = whatsappUrl
      ? `<a class="vacante-whatsapp" href="${esc(whatsappUrl)}" target="_blank" rel="noopener" aria-label="Contactanos por WhatsApp" data-tooltip="Contactanos">` +
          `<img src="/shared/img/whatsapp.svg" alt="" aria-hidden="true">` +
        `</a>`
      : '';
    const loadAttrs = index === 0 ? ' fetchpriority="high"' : ' loading="lazy" fetchpriority="low"';
    const image = `<img src="${esc(thumbUrl)}"${responsiveImageAttrs(region, 'vacantes', v.url)} data-full-src="${esc(fullUrl)}" alt="Oferta en ${regionName}"${imageDimensionAttrs(sourcePath)}${loadAttrs} decoding="async"${rot} ` +
      `onerror="this.onerror=null;this.src='/shared/img/placeholder.svg'">`;
    const visual = `<button type="button" class="vacante-modal-trigger" aria-label="Ampliar oferta ${esc(v.id)} en ${regionName}">${image}</button>`;
    return `<div class="vacante-item">` +
      visual +
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
    const filename = path.basename(String(item.url || ''));
    const rotation = Number(item.rotation);
    const rot = Number.isFinite(rotation) && rotation !== 0
      ? ` style="transform:rotate(${rotation}deg)"`
      : '';
    const sourcePath = uploadsPath('gdl', 'cupones', filename);
    const thumbUrl = optimizedMediaUrl('gdl', 'cupones', item.url, 'thumb');
    const fullUrl = optimizedMediaUrl('gdl', 'cupones', item.url, 'full');
    return `<div class="vacante-item" data-cupon>` +
      `<img src="${esc(thumbUrl)}" data-full-src="${esc(fullUrl)}" alt="Cupón en Guadalajara"${imageDimensionAttrs(sourcePath)} loading="lazy" decoding="async"${rot} ` +
      `onerror="this.onerror=null;this.src='/shared/img/placeholder.svg'">` +
    `</div>`;
  }).join('');
}

function injectCupones(html, region) {
  if (region !== 'gdl') return html;
  return html.replace('<!-- SSR:CUPONES -->', renderCupones());
}

function renderPortada(region) {
  const file = dataPath(region, 'portada.json');
  try {
    const { url, version } = readJson(file);
    if (!url) return { url: '/shared/img/placeholder.svg', poster: '/shared/img/logo-ofertas.png', width: 400, height: 300 };
    const sourcePath = uploadsPath(region, 'portadas', path.basename(url));
    const dimensions = readImageDimensions(sourcePath) || { width: 720, height: 900 };
    const cacheVersion = encodeURIComponent(version || path.basename(url));
    return {
      url: `${optimizedMediaUrl(region, 'portadas', url, 'cover')}&v=${cacheVersion}`,
      poster: `${optimizedMediaUrl(region, 'portadas', url, 'hero')}&v=${cacheVersion}`,
      width: dimensions.width,
      height: dimensions.height,
    };
  } catch (_) {
    return { url: '/shared/img/placeholder.svg', poster: '/shared/img/logo-ofertas.png', width: 400, height: 300 };
  }
}

function offerListSchema(region) {
  const regionName = region === 'gdl' ? 'Guadalajara' : 'Monterrey';
  const offers = readOffers(region).filter(offer => offer && offer.id && offer.url);
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    '@id': `${site.publicOrigin}/${region}/inicio/#offers`,
    name: `Ofertas en ${regionName}`,
    numberOfItems: offers.length,
    itemListElement: offers.map((offer, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${site.publicOrigin}${offerPath(region, offer.id)}`,
    })),
  };
}

function injectOfferListSchema(html, region) {
  if (!region || !html.includes('id="vacantes-grid"')) return html;
  const json = JSON.stringify(offerListSchema(region)).replace(/</g, '\\u003c');
  return html.replace('</head>', `  <script type="application/ld+json" id="offers-structured-data">${json}</script>\n</head>`);
}

function formatOfferDate(value) {
  const valid = validDateOnly(value);
  if (!valid) return '';
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${valid}T00:00:00Z`));
}

function renderOfferPage(region, offer) {
  const regionName = region === 'gdl' ? 'Guadalajara' : 'Monterrey';
  const canonicalPath = offerPath(region, offer.id);
  const canonicalUrl = `${site.publicOrigin}${canonicalPath}`;
  const cityUrl = `${site.publicOrigin}/${region}/inicio/`;
  const offerId = String(offer.id);
  const title = `Oferta ${offerId} en ${regionName} | Solo Ofertas`;
  const description = `Consulta la oferta ${offerId} publicada en ${regionName} en Solo Ofertas.`;
  const filename = path.basename(String(offer.url || ''));
  const sourcePath = uploadsPath(region, 'vacantes', filename);
  const thumbUrl = optimizedMediaUrl(region, 'vacantes', offer.url, 'thumb');
  const fullUrl = optimizedMediaUrl(region, 'vacantes', offer.url, 'full');
  const fullAbsoluteUrl = `${site.publicOrigin}${fullUrl}`;
  const published = validDateOnly(offer.fecha);
  const publishedLabel = formatOfferDate(offer.fecha);
  const rotation = Number(offer.rotation);
  const rotationStyle = Number.isFinite(rotation) && rotation !== 0
    ? ` style="transform:rotate(${rotation}deg)"`
    : '';
  const dateMarkup = published
    ? `<p class="oferta-date">Publicada el <time datetime="${published}">${escapeHtml(publishedLabel)}</time></p>`
    : '';
  let digits = String(offer.telefono || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `52${digits}`;
  const contactMarkup = digits
    ? `<a class="oferta-contact" href="https://wa.me/${escapeHtml(digits)}" target="_blank" rel="noopener">Contactar por WhatsApp</a>`
    : '';
  const dimensions = imageDimensionAttrs(sourcePath);
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${canonicalUrl}#webpage`,
        url: canonicalUrl,
        name: title,
        description,
        inLanguage: 'es-MX',
        isPartOf: { '@id': `${site.publicOrigin}/#website` },
        primaryImageOfPage: { '@id': `${canonicalUrl}#primaryimage` },
        breadcrumb: { '@id': `${canonicalUrl}#breadcrumb` },
        spatialCoverage: { '@type': 'City', name: regionName },
        ...(published ? { datePublished: published } : {}),
      },
      {
        '@type': 'ImageObject',
        '@id': `${canonicalUrl}#primaryimage`,
        contentUrl: fullAbsoluteUrl,
        url: fullAbsoluteUrl,
        caption: `Oferta en ${regionName}`,
        inLanguage: 'es-MX',
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${canonicalUrl}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${site.publicOrigin}/` },
          { '@type': 'ListItem', position: 2, name: `Ofertas en ${regionName}`, item: cityUrl },
          { '@type': 'ListItem', position: 3, name: `Oferta ${offerId}`, item: canonicalUrl },
        ],
      },
    ],
  };

  const replacements = {
    '__REGION__': region,
    '__REGION_NAME__': regionName,
    '__TITLE__': title,
    '__DESCRIPTION__': description,
    '__CANONICAL_URL__': canonicalUrl,
    '__CITY_PATH__': `/${region}/inicio/`,
    '__IMAGE_ABSOLUTE_URL__': fullAbsoluteUrl,
    '__IMAGE_SRC__': thumbUrl,
    '__IMAGE_SRCSET__': `${optimizedMediaUrl(region, 'vacantes', offer.url, 'small')} 360w, ${thumbUrl} 640w, ${fullUrl} 1200w`,
    '__IMAGE_DIMENSIONS__': dimensions,
    '__IMAGE_ROTATION__': rotationStyle,
    '__DATE_MARKUP__': dateMarkup,
    '__CONTACT_MARKUP__': contactMarkup,
    '__STRUCTURED_DATA__': JSON.stringify(structuredData).replace(/</g, '\\u003c'),
  };
  let html = readFragment(OFFER_PAGE_TEMPLATE);
  for (const [marker, value] of Object.entries(replacements)) {
    html = html.replaceAll(marker, String(value));
  }
  return injectFragments(html, region, 'inicio');
}

function injectPortadas(html) {
  if (!html.includes('__SSR_PORTADA_') && !html.includes('__SSR_HERO_POSTER_')) return html;
  const gdl = renderPortada('gdl');
  const mty = renderPortada('mty');
  return html
    .replaceAll('__SSR_PORTADA_GDL__', gdl.url)
    .replaceAll('__SSR_PORTADA_GDL_WIDTH__', String(gdl.width))
    .replaceAll('__SSR_PORTADA_GDL_HEIGHT__', String(gdl.height))
    .replaceAll('__SSR_HERO_POSTER_GDL__', gdl.poster)
    .replaceAll('__SSR_PORTADA_MTY__', mty.url)
    .replaceAll('__SSR_PORTADA_MTY_WIDTH__', String(mty.width))
    .replaceAll('__SSR_PORTADA_MTY_HEIGHT__', String(mty.height))
    .replaceAll('__SSR_HERO_POSTER_MTY__', mty.poster);
}

app.get(/^\/ofertas-(gdl|mty)\/?$/i, (req, res) => {
  const region = String(req.params[0]).toLowerCase();
  res.redirect(301, redirectUrl(req, `/${region}/inicio/`));
});
app.get(/^\/ofertas-(gdl|mty)\/(?:contacto\/?|directorio\.php)$/i, (req, res) => {
  const region = String(req.params[0]).toLowerCase();
  res.redirect(301, redirectUrl(req, `/${region}/contacto/`));
});
app.get('/:region(gdl|mty)/ofertas/:id/', (req, res, next) => {
  const { region, id } = req.params;
  const offer = readOffers(region, true).find(item => String(item && item.id) === String(id));
  if (!offer) return next();

  const html = renderOfferPage(region, offer);
  if (!html) return next(new Error('No se pudo cargar la plantilla de oferta'));
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-cache');
  res.set('X-Robots-Tag', 'noindex, follow');
  res.send(html);
});
app.get([
  /^\/ofertas-(?:gdl|mty)\/.+/i,
  /^\/(?:gdl|mty)\/consumidor(?:\/|$)/i,
  /^\/(?:gdl|mty)\/ofertas\/(?!\d+\/?$)[^/]+\/?$/i,
], (req, res) => {
  const regionMatch = req.path.match(/(?:^\/|ofertas-)(gdl|mty)(?:\/|$)/i);
  const html = injectFragments(readFragment(NOT_FOUND_PAGE), regionMatch && regionMatch[1].toLowerCase(), null);
  res.status(410);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-cache');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.send(html || '<!doctype html><title>Contenido retirado</title><h1>Contenido retirado</h1>');
});

// ponytail: redireccion reversible; conserva contenido y API para reactivarlos sin migracion.
app.use('/gdl/cupones', (_req, res) => res.redirect(301, '/gdl/inicio/'));
app.use(['/gdl/data/cupones.json', '/gdl/uploads/cupones'], (_req, res) => res.status(404).end());

app.get('/sitemap.xml', (_req, res) => {
  res.type('application/xml');
  res.set('Cache-Control', 'public, max-age=300');
  res.send(renderSitemapXml());
});

app.use('/admin', (_req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

app.use((req, res, next) => {
  let urlPath;
  try { urlPath = decodeURIComponent(req.path); } catch (_) { return res.status(400).end(); }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  if (!urlPath.endsWith('.html')) return next();

  const filePath = path.resolve(PAGES_DIR, `.${urlPath}`);
  if (!filePath.startsWith(`${path.resolve(PAGES_DIR)}${path.sep}`)) return next();

  const regionMatch = urlPath.match(/^\/(gdl|mty)\//);
  const region = regionMatch ? regionMatch[1] : null;
  const activePage = urlPath.includes('/contacto/') ? 'contacto' : 'inicio';

  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return next();
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.send(injectOfferListSchema(injectPortadas(injectCupones(injectVacantes(
      injectFragments(html, region, activePage), region
    ), region)), region));
  });
});

for (const region of REGIONS) {
  app.use(`/${region}/data`, express.static(
    path.dirname(dataPath(region, 'placeholder.json')),
    { setHeaders: setDataHeaders }
  ));
  app.use(`/${region}/uploads/vacantes`, express.static(
    uploadsPath(region, 'vacantes'),
    { setHeaders: setUploadHeaders }
  ));
  app.use(`/${region}/uploads/portadas`, express.static(
    uploadsPath(region, 'portadas'),
    { setHeaders: setUploadHeaders }
  ));
}
app.use('/gdl/uploads/cupones', express.static(
  uploadsPath('gdl', 'cupones'),
  { setHeaders: setUploadHeaders }
));
app.use(require('./routes/media'));
app.use('/shared/img', express.static(path.join(PAGES_DIR, 'shared', 'img'), {
  setHeaders: (res, filePath) => {
    if (path.extname(filePath).toLowerCase() === '.mp4') {
      // El navegador conserva una hora y el CDN puede conservar un dia.
      res.setHeader(
        'Cache-Control',
        'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400'
      );
    } else {
      setPageAssetHeaders(res, filePath);
    }
  },
}));
app.use(express.static(PAGES_DIR, { setHeaders: setPageAssetHeaders }));

// Routes
app.use('/soloofertas/auth', require('./routes/auth'));
app.use('/soloofertas/gdl', require('./routes/portada')('gdl'));
app.use('/soloofertas/mty', require('./routes/portada')('mty'));
app.use('/soloofertas/gdl', require('./routes/vacantes')('gdl'));
app.use('/soloofertas/mty', require('./routes/vacantes')('mty'));
app.use('/soloofertas/gdl', require('./routes/cupones')('gdl'));
app.use('/soloofertas/contacto', require('./routes/contacto'));
app.use('/soloofertas', require('./routes/backup'));

// Fallback 404 for unknown soloofertas routes
app.use('/soloofertas', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(404).json({ error: 'Ruta no encontrada' });
  const regionMatch = req.path.match(/^\/(gdl|mty)(?:\/|$)/);
  const region = regionMatch ? regionMatch[1] : null;
  const html = injectFragments(readFragment(NOT_FOUND_PAGE), region, null);
  res.status(404);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-cache');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.send(html || '<!doctype html><title>No encontrado</title><h1>Pagina no encontrada</h1>');
});

app.use((err, req, res, next) => {
  lifecycle('request_error', {
    method: req.method,
    path: req.originalUrl,
    error: errorDetails(err),
  }, 'error');

  if (res.headersSent) return next(err);
  const requestedStatus = Number(err.status || err.statusCode);
  const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599
    ? requestedStatus
    : 500;
  const message = status >= 400 && status < 500 && err.message ? err.message : 'Error interno';
  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Solo Ofertas API corriendo en puerto ${PORT}`);
  lifecycle('listening', { port: Number(PORT), memoryMb: memoryUsageMb() });
});

server.on('error', err => {
  lifecycle('server_error', { error: errorDetails(err), memoryMb: memoryUsageMb() }, 'error');
  process.exit(1);
});

server.on('close', () => {
  lifecycle('server_closed', { memoryMb: memoryUsageMb() });
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} recibido; cerrando servidor...`);
  lifecycle('shutdown_started', { signal, memoryMb: memoryUsageMb() });

  const timeout = setTimeout(() => {
    console.error('Cierre forzado despues de 10 segundos');
    lifecycle('shutdown_timeout', { signal, memoryMb: memoryUsageMb() }, 'error');
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
process.on('SIGHUP', () => shutdown('SIGHUP'));

process.on('uncaughtException', (err, origin) => {
  lifecycle('uncaught_exception', {
    origin,
    error: errorDetails(err),
    memoryMb: memoryUsageMb(),
  }, 'error');
  process.exit(1);
});

process.on('unhandledRejection', reason => {
  lifecycle('unhandled_rejection', { error: errorDetails(reason), memoryMb: memoryUsageMb() }, 'error');
  process.exit(1);
});

process.on('beforeExit', code => {
  lifecycle('before_exit', { code, memoryMb: memoryUsageMb() });
});

process.on('exit', code => {
  lifecycle('exit', { code, memoryMb: memoryUsageMb() }, code === 0 ? 'info' : 'error');
});
