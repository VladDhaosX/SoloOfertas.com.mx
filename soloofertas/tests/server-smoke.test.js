const assert = require('assert');
const fs = require('fs');
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

async function waitForServer(url, child, stderr) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`El servidor termino antes de responder:\n${stderr.join('')}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response;
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
    assert(html.includes('id="site-header"'));
    assert(!html.includes('<!-- SSR:VACANTES -->'));
    assert(!html.includes('<!-- SSR:CUPONES -->'));

    const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(
      Object.fromEntries(Object.entries(await healthResponse.json()).filter(([key]) => ['status', 'content'].includes(key))),
      { status: 'ok', content: 'ready' }
    );

    fs.writeFileSync(path.join(tempDir, 'gdl', 'data', 'vacantes.json'), '{invalido', 'utf8');
    const unhealthyResponse = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(unhealthyResponse.status, 503);
    assert.deepEqual(await unhealthyResponse.json(), { status: 'error', content: 'unavailable' });

    console.log('Server smoke: inicio, contenido persistente, SSR y health check OK');
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
