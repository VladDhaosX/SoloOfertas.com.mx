const assert = require('assert');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloofertas-r2-routes-'));
process.env.CONTENT_DIR = tempDir;
process.env.JWT_SECRET = 'r2-routes-test-secret';

const dataDir = path.join(tempDir, 'gdl', 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'vacantes.json'), '[]\n');
fs.writeFileSync(path.join(dataDir, 'cupones.json'), '[]\n');
fs.writeFileSync(path.join(dataDir, 'portada.json'), JSON.stringify({
  url: 'https://soloofertas-images.example.workers.dev/cover/gdl/portadas/old.jpg',
  media: { provider: 'r2', key: 'gdl/portadas/old.jpg' },
}));

const deleted = [];
function mediaFor(key) {
  const [, type] = key.split('/');
  const presets = type === 'portadas' ? ['cover', 'hero'] :
    type === 'vacantes' ? ['small', 'thumb', 'full', 'admin'] : ['thumb', 'full', 'admin'];
  return {
    provider: 'r2',
    key,
    urls: Object.fromEntries(presets.map(preset => [preset, `https://soloofertas-images.example.workers.dev/${preset}/${key}`])),
  };
}
const storage = {
  async signUpload({ region, type }) {
    return { key: `${region}/${type}/signed.jpg`, uploadUrl: 'https://r2.example/upload', headers: {}, expiresIn: 300 };
  },
  async completeUpload(key, region, type) {
    assert(key.startsWith(`${region}/${type}/`));
    return mediaFor(key);
  },
  publicUrl(media, type) {
    return media.urls[type === 'portadas' ? 'cover' : 'full'];
  },
  async deleteKey(key) { deleted.push(key); return true; },
  async deleteItem(item) { if (item?.media?.key) deleted.push(item.media.key); return true; },
};

const app = express();
app.use(express.json());
app.use('/soloofertas/gdl', require('../routes/uploads')('gdl', { storage }));
app.use('/soloofertas/gdl', require('../routes/portada')('gdl', { storage }));
app.use('/soloofertas/gdl', require('../routes/vacantes')('gdl', { storage }));
app.use('/soloofertas/gdl', require('../routes/cupones')('gdl', { storage }));

async function run() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/soloofertas/gdl`;
  const headers = {
    Authorization: `Bearer ${jwt.sign({ rol: 'admin' }, process.env.JWT_SECRET, { expiresIn: '5m' })}`,
    'Content-Type': 'application/json',
  };
  const request = (url, options = {}) => fetch(`${base}${url}`, { ...options, headers: { ...headers, ...options.headers } });

  try {
    let response = await request('/media/uploads', {
      method: 'POST',
      body: JSON.stringify({ type: 'vacantes', mime: 'image/jpeg', size: 100 }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).key, 'gdl/vacantes/signed.jpg');

    response = await request('/vacantes', {
      method: 'POST',
      body: JSON.stringify({ key: 'gdl/vacantes/one.jpg' }),
    });
    const vacante = await response.json();
    assert.equal(response.status, 200);
    assert.equal(vacante.url, vacante.media.urls.full);

    response = await request('/vacantes/replace-all', {
      method: 'POST',
      body: JSON.stringify({ keys: ['gdl/vacantes/two.jpg', 'gdl/vacantes/three.jpg'] }),
    });
    assert.equal((await response.json()).total, 2);
    assert(deleted.includes('gdl/vacantes/one.jpg'));

    response = await request('/portada', {
      method: 'POST',
      body: JSON.stringify({ key: 'gdl/portadas/new.jpg' }),
    });
    assert.equal(response.status, 200);
    const portada = JSON.parse(fs.readFileSync(path.join(dataDir, 'portada.json'), 'utf8'));
    assert.equal(portada.url, portada.media.urls.cover);
    assert(deleted.includes('gdl/portadas/old.jpg'));

    response = await request('/cupones', {
      method: 'POST',
      body: JSON.stringify({ key: 'gdl/cupones/coupon.jpg' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).media.provider, 'r2');
    console.log('Rutas R2: firma, publicacion, reemplazo y limpieza OK');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
