const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { TYPE_PRESETS } = require('../services/r2-storage');

const APP_ROOT = path.join(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloofertas-r2-public-'));
const baseImages = 'https://soloofertas-images.example.workers.dev';

function remoteItem(region, type, filename, extra = {}) {
  const key = `${region}/${type}/${filename}`;
  const urls = Object.fromEntries(TYPE_PRESETS[type].map(preset => [preset, `${baseImages}/${preset}/${key}`]));
  return { ...extra, url: urls[type === 'portadas' ? 'cover' : 'full'], media: { provider: 'r2', key, urls } };
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(err => err ? reject(err) : resolve(port));
    });
  });
}

async function waitFor(url, child, stderr) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(stderr.join(''));
    try {
      const response = await fetch(url);
      if (response.status === 200) return response;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Servidor R2 no disponible: ${stderr.join('')}`);
}

async function run() {
  const offerId = '11111111-2222-4333-8444-555555555555';
  for (const region of ['gdl', 'mty']) {
    const dataDir = path.join(tempDir, region, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'portada.json'), JSON.stringify(remoteItem(region, 'portadas', 'cover.jpg')));
    fs.writeFileSync(path.join(dataDir, 'vacantes.json'), JSON.stringify(region === 'gdl' ? [
      remoteItem(region, 'vacantes', 'offer.jpg', { id: offerId, fecha: '2026-07-31', rotation: 0, telefono: '' }),
    ] : []));
  }
  fs.writeFileSync(path.join(tempDir, 'gdl', 'data', 'cupones.json'), '[]\n');

  const port = await reservePort();
  const stderr = [];
  const child = spawn(process.execPath, [path.join(APP_ROOT, 'server.js')], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CONTENT_DIR: tempDir,
      PORT: String(port),
      MEDIA_STORAGE: 'r2',
      R2_ACCOUNT_ID: 'account-test',
      R2_BUCKET: 'soloofertas-media-prod',
      R2_ACCESS_KEY_ID: 'access-test',
      R2_SECRET_ACCESS_KEY: 'secret-test',
      MEDIA_DELIVERY_BASE_URL: baseImages,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', chunk => stderr.push(chunk.toString()));

  try {
    const home = await waitFor(`http://127.0.0.1:${port}/gdl/inicio/`, child, stderr);
    const html = await home.text();
    assert(html.includes(`${baseImages}/small/gdl/vacantes/offer.jpg`));
    assert(html.includes(`${baseImages}/thumb/gdl/vacantes/offer.jpg`));
    assert(html.includes(`${baseImages}/hero/gdl/portadas/cover.jpg`));

    const offer = await (await fetch(`http://127.0.0.1:${port}/gdl/ofertas/${offerId}/`)).text();
    assert(offer.includes(`${baseImages}/full/gdl/vacantes/offer.jpg`));
    assert(!offer.includes('https://soloofertas.comhttps://'));

    assert.equal((await fetch(`http://127.0.0.1:${port}/health/ready`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/media/gdl/vacantes/offer.jpg?preset=thumb`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/gdl/uploads/vacantes/offer.jpg`)).status, 404);
    console.log('Servidor R2: URLs remotas, SEO y rutas locales desactivadas OK');
  } finally {
    if (child.exitCode === null) {
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
