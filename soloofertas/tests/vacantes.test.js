const assert = require('assert');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloofertas-vacantes-'));
process.env.CONTENT_DIR = tempDir;
process.env.JWT_SECRET = 'vacantes-test-secret';

const dataDir = path.join(tempDir, 'gdl', 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'vacantes.json'), JSON.stringify([{
  id: 'offer-1',
  url: '/gdl/uploads/vacantes/offer.jpg',
  rotation: 0,
  telefono: '',
}]));

const app = express();
app.use(express.json());
app.use('/soloofertas/gdl', require('../routes/vacantes')('gdl'));

async function run() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/soloofertas/gdl`;
  const headers = {
    Authorization: `Bearer ${jwt.sign({ usuario: 'test' }, process.env.JWT_SECRET, { expiresIn: '5m' })}`,
  };
  try {
    let response = await fetch(`${base}/vacantes/offer-1/rotate`, { method: 'PUT', headers });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rotation, 90);

    response = await fetch(`${base}/vacantes/offer-1/rotate`, { method: 'PUT', headers });
    assert.equal((await response.json()).rotation, 180);
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'vacantes.json'), 'utf8'));
    assert.equal(saved[0].rotation, 180);
    assert(fs.existsSync(path.join(tempDir, '.backups', 'json', 'gdl', 'data')));

    response = await fetch(`${base}/vacantes/missing/rotate`, { method: 'PUT', headers });
    assert.equal(response.status, 404);
    console.log('Vacantes API: rotacion atomica, persistencia y 404 OK');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
