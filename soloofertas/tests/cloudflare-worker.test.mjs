import assert from 'node:assert/strict';
import worker, { parseRequestPath } from '../cloudflare/image-worker/src/index.mjs';

const originalFetch = globalThis.fetch;
const calls = [];
try {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(new Uint8Array([1]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  };

  assert.deepEqual(parseRequestPath('/small/gdl/vacantes/image.jpg'), {
    preset: 'small', region: 'gdl', type: 'vacantes', filename: 'image.jpg',
  });
  assert.deepEqual(parseRequestPath('/hero/mty/portadas/cover.jpg'), {
    preset: 'hero', region: 'mty', type: 'portadas', filename: 'cover.jpg',
  });
  assert.equal(parseRequestPath('/small/gdl/portadas/image.jpg'), null);
  assert.equal(parseRequestPath('/thumb/mty/cupones/image.jpg'), null);

  const response = await worker.fetch(
    new Request('https://soloofertas-images.example.workers.dev/small/gdl/vacantes/image.jpg'),
    { R2_PUBLIC_BASE_URL: 'https://pub-example.r2.dev/' }
  );
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, 'https://pub-example.r2.dev/gdl/vacantes/image.jpg');
  assert.equal(calls[0].options.cf.image.width, 360);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  console.log('Worker: presets de Solo Ofertas, rutas cerradas y origen R2 OK');
} finally {
  globalThis.fetch = originalFetch;
}
