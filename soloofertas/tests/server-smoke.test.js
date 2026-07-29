const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const APP_ROOT = path.join(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloofertas-server-'));

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(err => err ? reject(err) : resolve(port));
    });
  });
}

function requestWithHost(port, requestPath, host) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      method: 'GET',
      headers: { Host: host },
    }, response => {
      response.resume();
      response.once('end', () => resolve(response));
    });
    request.once('error', reject);
    request.end();
  });
}

async function waitForServer(url, child, stderr, expectedStatus = 200) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`El servidor termino antes de responder:\n${stderr.join('')}`);
    }
    try {
      const response = await fetch(url);
      if (response.status === expectedStatus) return response;
    } catch (_) {
      // El puerto todavia no esta listo.
    }
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error(`El servidor no respondio a tiempo:\n${stderr.join('')}`);
}

async function run() {
  let child;
  try {
    for (const region of ['gdl', 'mty']) {
      fs.cpSync(
        path.join(APP_ROOT, 'pages', region, 'data'),
        path.join(tempDir, region, 'data'),
        { recursive: true }
      );
    }

    const port = await reservePort();
    const stderr = [];
    child = spawn(process.execPath, [path.join(APP_ROOT, 'server.js')], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        CONTENT_DIR: tempDir,
        PORT: String(port),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.on('data', chunk => stderr.push(chunk.toString()));

    const response = await waitForServer(`http://127.0.0.1:${port}/gdl/inicio/`, child, stderr);
    const html = await response.text();
    const gdlOffers = JSON.parse(fs.readFileSync(path.join(tempDir, 'gdl', 'data', 'vacantes.json'), 'utf8'));
    const mtyOffers = JSON.parse(fs.readFileSync(path.join(tempDir, 'mty', 'data', 'vacantes.json'), 'utf8'));
    const firstGdlOffer = gdlOffers[0];
    const firstGdlOfferPath = `/gdl/ofertas/${firstGdlOffer.id}/`;
    assert(html.includes('id="site-header"'));
    assert(!html.includes('<!-- SSR:VACANTES -->'));
    assert(!html.includes('<!-- SSR:CUPONES -->'));
    assert(!html.includes('data-cupon'));
    assert(!html.includes('href="/gdl/cupones/"'));
    assert(html.includes('src="/shared/img/hero-gdl.mp4"'));
    assert(html.includes('poster="/media/gdl/portadas/'));
    assert(html.includes('autoplay muted loop playsinline preload="metadata"'));
    assert(html.includes('<link rel="canonical" href="https://soloofertas.com/gdl/inicio/">'));
    assert(html.includes(`href="${firstGdlOfferPath}"`));
    assert(html.includes('?preset=small 360w'));
    assert(html.includes('id="offers-structured-data"'));
    assert(html.includes('"@type":"ItemList"'));
    assert(html.includes('href="https://soloempleos.com.mx/gdl/inicio/"'));
    assert(html.includes('class="header-whatsapp"'));
    assert(!html.includes('hero-destacado.mp4'));
    assert(!html.includes('hero-carousel-controls'));
    assert.equal((html.match(/class="hero-video/g) || []).length, 1);

    const mtyResponse = await fetch(`http://127.0.0.1:${port}/mty/inicio/`);
    const mtyHtml = await mtyResponse.text();
    assert(mtyHtml.includes('src="/shared/img/hero-mty.mp4"'));
    assert(mtyHtml.includes('href="/mty/contacto/"'));
    assert(mtyHtml.includes('href="https://soloempleos.com.mx/mty/inicio/"'));
    assert(!mtyHtml.includes('hero-destacado.mp4'));
    assert(!mtyHtml.includes('hero-carousel-controls'));
    assert.equal((mtyHtml.match(/class="hero-video/g) || []).length, 1);

    const offerResponse = await fetch(`http://127.0.0.1:${port}${firstGdlOfferPath}`);
    const offerHtml = await offerResponse.text();
    assert.equal(offerResponse.status, 200);
    assert(offerHtml.includes(`<link rel="canonical" href="https://soloofertas.com${firstGdlOfferPath}">`));
    assert(offerHtml.includes('<h1>Oferta en Guadalajara</h1>'));
    assert(offerHtml.includes('"@type":"ImageObject"'));
    assert(offerHtml.includes('"@type":"BreadcrumbList"'));
    assert(offerHtml.includes('?preset=full'));
    assert(!offerHtml.includes('__IMAGE_'));

    const offerCanonicalResponse = await fetch(
      `http://127.0.0.1:${port}${firstGdlOfferPath.slice(0, -1)}`,
      { redirect: 'manual' }
    );
    assert.equal(offerCanonicalResponse.status, 301);
    assert.equal(offerCanonicalResponse.headers.get('location'), firstGdlOfferPath);

    const missingOfferResponse = await fetch(`http://127.0.0.1:${port}/gdl/ofertas/no-existe/`);
    assert.equal(missingOfferResponse.status, 404);
    assert.equal(missingOfferResponse.headers.get('x-robots-tag'), 'noindex, nofollow');

    const cuponesResponse = await fetch(`http://127.0.0.1:${port}/gdl/cupones/`, { redirect: 'manual' });
    assert.equal(cuponesResponse.status, 302);
    assert.equal(cuponesResponse.headers.get('location'), '/gdl/inicio/');
    assert.equal((await fetch(`http://127.0.0.1:${port}/gdl/data/cupones.json`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/gdl/uploads/cupones/001-adiestramiento-canino.png`)).status, 404);

    const adminResponse = await fetch(`http://127.0.0.1:${port}/admin/`);
    const adminHtml = await adminResponse.text();
    assert(adminHtml.includes('id="section-cupones" data-feature-coupons hidden'));
    assert(adminHtml.includes('data-admin-section="portada"'));
    assert(adminHtml.includes('id="btn-backup"'));
    assert(adminHtml.includes('/admin/js/admin.js?v=20260728'));
    assert.equal(adminResponse.headers.get('x-robots-tag'), 'noindex, nofollow');

    const adminJsResponse = await fetch(`http://127.0.0.1:${port}/admin/js/admin.js?v=20260728`);
    assert.equal(adminJsResponse.status, 200);
    assert((await adminJsResponse.text()).includes('role="menuitem">Rotar 90&deg;'));

    const heroVideoResponse = await fetch(
      `http://127.0.0.1:${port}/shared/img/hero-gdl.mp4`,
      { method: 'HEAD' }
    );
    assert.equal(heroVideoResponse.status, 200);
    assert.equal(heroVideoResponse.headers.get('content-type'), 'video/mp4');
    assert.equal(
      heroVideoResponse.headers.get('cache-control'),
      'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400'
    );

    const scannerPaths = [
      '/wp-admin/install.php?step=1',
      '/wp-content/plugins/example/file.php',
      '/wp-includes/js/jquery.js',
      '/wp-json/wp/v2/users',
      '/wp-login.php',
      '/xmlrpc.php',
    ];
    for (const scannerPath of scannerPaths) {
      const scannerResponse = await fetch(`http://127.0.0.1:${port}${scannerPath}`, {
        redirect: 'manual',
      });
      assert.equal(scannerResponse.status, 404);
      assert.equal(scannerResponse.headers.get('location'), null);
      assert.equal(
        scannerResponse.headers.get('cache-control'),
        'public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400'
      );
      assert.equal(scannerResponse.headers.get('x-robots-tag'), 'noindex, nofollow');
    }

    const similarPathResponse = await fetch(`http://127.0.0.1:${port}/wp-administrator`, {
      redirect: 'manual',
    });
    assert.equal(similarPathResponse.status, 404);
    assert.equal(similarPathResponse.headers.get('location'), null);
    assert.equal(similarPathResponse.headers.get('x-robots-tag'), 'noindex, nofollow');

    const canonicalResponse = await fetch(
      `http://127.0.0.1:${port}/GDL/inicio/index.html?utm_source=test&custom-css=1`,
      { redirect: 'manual' }
    );
    assert.equal(canonicalResponse.status, 301);
    assert.equal(canonicalResponse.headers.get('location'), '/gdl/inicio/?utm_source=test');

    const wwwResponse = await requestWithHost(port, '/mty', 'www.soloofertas.com');
    assert.equal(wwwResponse.statusCode, 301);
    assert.equal(wwwResponse.headers.location, 'https://soloofertas.com/mty/inicio/');

    const sitemapResponse = await fetch(`http://127.0.0.1:${port}/sitemap.xml`);
    const sitemap = await sitemapResponse.text();
    assert.equal(sitemapResponse.status, 200);
    assert(sitemap.includes('https://soloofertas.com/gdl/inicio/'));
    assert(sitemap.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'));
    assert(sitemap.includes(`https://soloofertas.com${firstGdlOfferPath}`));
    assert(sitemap.includes('<image:image>'));
    assert.equal((sitemap.match(/<url>/g) || []).length, 5 + gdlOffers.length + mtyOffers.length);
    assert(!sitemap.includes('/cupones/'));

    const robotsResponse = await fetch(`http://127.0.0.1:${port}/robots.txt`);
    assert.equal(robotsResponse.status, 200);
    assert((await robotsResponse.text()).includes('Sitemap: https://soloofertas.com/sitemap.xml'));

    const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(health.status, 'ok');
    assert.equal(typeof health.instanceId, 'string');
    assert.equal(healthResponse.headers.get('x-app-instance'), health.instanceId);

    const liveResponse = await fetch(`http://127.0.0.1:${port}/health/live`);
    assert.equal(liveResponse.status, 200);
    assert.equal((await liveResponse.json()).instanceId, health.instanceId);

    const readyResponse = await fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.equal(readyResponse.status, 200);
    assert.equal((await readyResponse.json()).content, 'ready');

    fs.writeFileSync(path.join(tempDir, 'gdl', 'data', 'vacantes.json'), '{invalido', 'utf8');
    const stillLiveResponse = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(stillLiveResponse.status, 200);

    const unhealthyResponse = await fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.equal(unhealthyResponse.status, 503);
    assert.equal((await unhealthyResponse.json()).content, 'unavailable');

    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
    child = null;

    const recoveryPort = await reservePort();
    const recoveryStderr = [];
    child = spawn(process.execPath, [path.join(APP_ROOT, 'server.js')], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        CONTENT_DIR: '',
        PORT: String(recoveryPort),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.on('data', chunk => recoveryStderr.push(chunk.toString()));

    const recoveryResponse = await waitForServer(
      `http://127.0.0.1:${recoveryPort}/health`,
      child,
      recoveryStderr
    );
    assert.equal((await recoveryResponse.json()).status, 'ok');
    const recoveryReadyResponse = await fetch(`http://127.0.0.1:${recoveryPort}/health/ready`);
    assert.equal(recoveryReadyResponse.status, 503);
    assert.equal((await recoveryReadyResponse.json()).content, 'unavailable');
    assert(recoveryStderr.join('').includes('Contenido no disponible al iniciar'));

    console.log('Server smoke: inicio, recuperacion, contenido persistente, SSR, cache y health checks OK');
  } finally {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
