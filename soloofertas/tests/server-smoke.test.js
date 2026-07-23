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
    assert(html.includes('id="site-header"'));
    assert(!html.includes('<!-- SSR:VACANTES -->'));
    assert(!html.includes('<!-- SSR:CUPONES -->'));
    assert(html.includes('src="/shared/img/hero-destacado.mp4"'));
    assert(html.indexOf('hero-destacado.mp4') < html.indexOf('hero-gdl.mp4'));
    assert.equal((html.match(/data-hero-slide/g) || []).length, 2);

    const mtyResponse = await fetch(`http://127.0.0.1:${port}/mty/inicio/`);
    const mtyHtml = await mtyResponse.text();
    assert(mtyHtml.indexOf('hero-destacado.mp4') < mtyHtml.indexOf('hero-mty.mp4'));
    assert.equal((mtyHtml.match(/data-hero-slide/g) || []).length, 2);

    const heroVideoResponse = await fetch(
      `http://127.0.0.1:${port}/shared/img/hero-destacado.mp4`,
      { method: 'HEAD' }
    );
    assert.equal(heroVideoResponse.status, 200);
    assert.equal(heroVideoResponse.headers.get('content-type'), 'video/mp4');

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
      recoveryStderr,
      503
    );
    assert.deepEqual(await recoveryResponse.json(), { status: 'error', content: 'unavailable' });
    assert(recoveryStderr.join('').includes('Contenido no disponible al iniciar'));

    console.log('Server smoke: inicio, recuperacion, contenido persistente, SSR y health check OK');
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
