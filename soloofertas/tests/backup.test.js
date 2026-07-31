const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const unzipper = require('unzipper');
const { PassThrough } = require('stream');
const { TYPE_PRESETS } = require('../services/r2-storage');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloofertas-backup-'));
process.env.CONTENT_DIR = tempDir;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';

function remoteItem(region, type, filename, extra = {}) {
  const key = `${region}/${type}/${filename}`;
  const base = 'https://soloofertas-images.example.workers.dev';
  const urls = Object.fromEntries(TYPE_PRESETS[type].map(preset => [preset, `${base}/${preset}/${key}`]));
  return {
    ...extra,
    url: urls[type === 'portadas' ? 'cover' : 'full'],
    media: { provider: 'r2', key, urls },
  };
}

async function makeZip(entries) {
  const { ZipArchive } = await import('archiver');
  const output = new PassThrough();
  const chunks = [];
  output.on('data', chunk => chunks.push(chunk));
  const complete = new Promise((resolve, reject) => {
    output.once('end', () => resolve(Buffer.concat(chunks)));
    output.once('error', reject);
  });
  const archive = new ZipArchive({ zlib: { level: 1 } });
  archive.once('error', error => output.destroy(error));
  archive.pipe(output);
  for (const entry of entries) archive.append(entry.contents, { name: entry.name });
  await archive.finalize();
  return complete;
}

async function seedContent() {
  for (const region of ['gdl', 'mty']) {
    const dataDir = path.join(tempDir, region, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'portada.json'), JSON.stringify(
      remoteItem(region, 'portadas', 'cover.jpg', { version: 'one' })
    ));
    fs.writeFileSync(path.join(dataDir, 'vacantes.json'), JSON.stringify([
      remoteItem(region, 'vacantes', 'offer.jpg', { id: `${region}-original`, rotation: 0, telefono: '' }),
    ]));
  }
  fs.writeFileSync(path.join(tempDir, 'gdl', 'data', 'cupones.json'), JSON.stringify([
    remoteItem('gdl', 'cupones', 'coupon.jpg', { id: 'coupon-original', rotation: 0 }),
  ]));
}

async function run() {
  let server;
  try {
    await seedContent();
    const app = express();
    app.use('/soloofertas', require('../routes/backup'));
    app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/soloofertas`;
    const token = jwt.sign({ rol: 'admin' }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const headers = { Authorization: `Bearer ${token}` };

    assert.equal((await fetch(`${base}/backup`)).status, 401);
    const download = await fetch(`${base}/backup`, { headers });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/zip');
    const zip = Buffer.from(await download.arrayBuffer());
    assert(zip.length > 100);
    const archive = await unzipper.Open.buffer(zip);
    assert(!archive.files.some(entry => entry.path.includes('/uploads/')));

    const invalidForm = new FormData();
    invalidForm.append('backup', new Blob([Buffer.from('not-a-zip')], { type: 'application/zip' }), 'invalid.zip');
    const invalid = await fetch(`${base}/backup/restore`, { method: 'POST', headers, body: invalidForm });
    assert.equal(invalid.status, 400);

    const forbiddenZip = await makeZip([{
      name: 'gdl/uploads/vacantes/readme.txt',
      contents: 'esta extension no esta permitida',
    }]);
    const forbiddenForm = new FormData();
    forbiddenForm.append('backup', new Blob([forbiddenZip], { type: 'application/zip' }), 'forbidden.zip');
    const forbidden = await fetch(`${base}/backup/restore`, {
      method: 'POST', headers, body: forbiddenForm,
    });
    assert.equal(forbidden.status, 400);
    assert((await forbidden.json()).error.includes('Ruta no permitida'));

    const currentVacantes = path.join(tempDir, 'gdl', 'data', 'vacantes.json');
    fs.writeFileSync(currentVacantes, JSON.stringify([
      remoteItem('gdl', 'vacantes', 'mutated.jpg', { id: 'mutated', rotation: 0, telefono: '' }),
    ]));

    const form = new FormData();
    form.append('backup', new Blob([zip], { type: 'application/zip' }), 'backup.zip');
    const restored = await fetch(`${base}/backup/restore`, { method: 'POST', headers, body: form });
    const result = await restored.json();
    assert.equal(restored.status, 200, JSON.stringify(result));
    assert.equal(result.ok, true);
    assert.equal(JSON.parse(fs.readFileSync(currentVacantes, 'utf8'))[0].id, 'gdl-original');

    const snapshotVacantes = path.join(
      tempDir, '.backups', 'restores', result.snapshot, 'gdl', 'data', 'vacantes.json'
    );
    assert.equal(JSON.parse(fs.readFileSync(snapshotVacantes, 'utf8'))[0].id, 'mutated');

    console.log('Backup API: autenticacion, ZIP, validacion, restauracion y snapshot rollback OK');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
