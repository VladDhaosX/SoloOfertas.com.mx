const assert = require('assert');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloofertas-cupones-'));
process.env.CONTENT_DIR = tempDir;
process.env.JWT_SECRET = 'cupones-test-secret';
const dataDir = path.join(tempDir, 'gdl', 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'cupones.json'), JSON.stringify([
  { id: 'one', url: 'https://images.test/full/gdl/cupones/one.jpg', rotation: 0, media: { provider: 'r2', key: 'gdl/cupones/one.jpg' } },
  { id: 'two', url: 'https://images.test/full/gdl/cupones/two.jpg', rotation: 0, media: { provider: 'r2', key: 'gdl/cupones/two.jpg' } },
]));

const deleted = [];
const storage = { async deleteItem(item) { deleted.push(item.media.key); return true; } };
const app = express();
app.use(express.json());
app.use('/soloofertas/gdl', require('../routes/cupones')('gdl', { storage }));

async function run() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/soloofertas/gdl`;
  const headers = {
    Authorization: `Bearer ${jwt.sign({ rol: 'admin' }, process.env.JWT_SECRET, { expiresIn: '5m' })}`,
    'Content-Type': 'application/json',
  };
  try {
    let response = await fetch(`${base}/cupones/one/rotate`, { method: 'PUT', headers });
    assert.equal((await response.json()).rotation, 90);

    response = await fetch(`${base}/cupones/reorder`, {
      method: 'PUT', headers, body: JSON.stringify({ ids: ['two', 'one'] }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${base}/cupones/one`, { method: 'DELETE', headers });
    assert.equal(response.status, 200);
    assert.deepEqual(deleted, ['gdl/cupones/one.jpg']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'cupones.json'), 'utf8')).map(item => item.id), ['two']);
    console.log('Cupones API: rotacion, orden, borrado R2 y persistencia OK');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
