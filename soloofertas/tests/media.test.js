const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const sharp = require('sharp');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloofertas-media-'));
process.env.CONTENT_DIR = tempDir;
process.env.NODE_ENV = 'test';

async function run() {
  let server;
  try {
    const uploads = path.join(tempDir, 'gdl', 'uploads', 'vacantes');
    fs.mkdirSync(uploads, { recursive: true });
    await sharp({
      create: { width: 800, height: 400, channels: 3, background: '#1957c4' },
    }).jpeg().toFile(path.join(uploads, 'sample.jpg'));

    const app = express();
    app.use(require('../routes/media'));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    const responses = await Promise.all([
      fetch(`${base}/media/gdl/vacantes/sample.jpg?preset=thumb`),
      fetch(`${base}/media/gdl/vacantes/sample.jpg?preset=thumb`),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/webp');
      assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      const buffer = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(buffer).metadata();
      assert.equal(metadata.format, 'webp');
      assert.equal(metadata.width, 640);
      assert.equal(metadata.height, 320);
    }

    const smallResponse = await fetch(`${base}/media/gdl/vacantes/sample.jpg?preset=small`);
    assert.equal(smallResponse.status, 200);
    const smallMetadata = await sharp(Buffer.from(await smallResponse.arrayBuffer())).metadata();
    assert.equal(smallMetadata.width, 360);
    assert.equal(smallMetadata.height, 180);

    const cacheDir = path.join(uploads, '.cache');
    assert.equal(fs.readdirSync(cacheDir).filter(name => name.endsWith('.webp')).length, 2);
    assert.equal((await fetch(`${base}/media/gdl/vacantes/sample.jpg?preset=unknown`)).status, 400);
    assert.equal((await fetch(`${base}/media/gdl/vacantes/missing.jpg?preset=thumb`)).status, 404);
    assert.equal((await fetch(`${base}/media/gdl/cupones/sample.jpg?preset=thumb`)).status, 404);

    console.log('Media API: presets cerrados, WebP, cache, concurrencia y rutas invalidas OK');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
