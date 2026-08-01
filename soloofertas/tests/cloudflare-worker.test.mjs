import assert from 'node:assert/strict';
import worker, {
  objectKey,
  parseRequestPath,
  responseFormat,
} from '../cloudflare/image-worker/src/index.mjs';

const calls = [];
const imageChain = {
  transform(options) {
    calls.push({ operation: 'transform', options });
    return this;
  },
  async output(options) {
    calls.push({ operation: 'output', options });
    return {
      response() {
        return new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'Content-Type': options.format },
        });
      },
    };
  },
};
const env = {
  MEDIA_BUCKET: {
    async get(key) {
      calls.push({ operation: 'get', key });
      return {
        body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); } }),
        httpMetadata: { contentType: 'image/jpeg' },
      };
    },
  },
  IMAGES: {
    input(stream) {
      calls.push({ operation: 'input', stream });
      return imageChain;
    },
  },
};

assert.deepEqual(parseRequestPath('/small/gdl/vacantes/image.jpg'), {
  preset: 'small', region: 'gdl', type: 'vacantes', filename: 'image.jpg',
});
assert.deepEqual(parseRequestPath('/hero/mty/portadas/cover.jpg'), {
  preset: 'hero', region: 'mty', type: 'portadas', filename: 'cover.jpg',
});
assert.equal(parseRequestPath('/small/gdl/portadas/image.jpg'), null);
assert.equal(parseRequestPath('/thumb/mty/cupones/image.jpg'), null);
assert.equal(objectKey(parseRequestPath('/small/gdl/vacantes/image.jpg')), 'gdl/vacantes/image.jpg');
assert.equal(responseFormat('image/avif,image/webp,image/*', 'image/jpeg'), 'image/avif');
assert.equal(responseFormat('image/webp,image/*', 'image/jpeg'), 'image/webp');
assert.equal(responseFormat('*/*', 'image/png'), 'image/png');

const response = await worker.fetch(
  new Request('https://soloofertas-images.example.workers.dev/small/gdl/vacantes/image.jpg', {
    headers: { Accept: 'image/avif,image/webp,image/*' },
  }),
  env
);
assert.equal(response.status, 200);
assert.equal(calls[0].operation, 'get');
assert.equal(calls[0].key, 'gdl/vacantes/image.jpg');
assert.deepEqual(calls.find(call => call.operation === 'transform').options, {
  width: 360,
  fit: 'scale-down',
});
assert.deepEqual(calls.find(call => call.operation === 'output').options, {
  format: 'image/avif',
  quality: 64,
});
assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
assert.equal(response.headers.get('vary'), 'Accept');
assert.equal(response.headers.get('access-control-allow-origin'), '*');

const missing = await worker.fetch(
  new Request('https://soloofertas-images.example.workers.dev/cover/gdl/portadas/missing.jpg'),
  { ...env, MEDIA_BUCKET: { async get() { return null; } } }
);
assert.equal(missing.status, 404);

const unconfigured = await worker.fetch(
  new Request('https://soloofertas-images.example.workers.dev/cover/gdl/portadas/image.jpg'),
  {}
);
assert.equal(unconfigured.status, 503);

const invalid = await worker.fetch(
  new Request('https://soloofertas-images.example.workers.dev/small/gdl/portadas/image.jpg'),
  env
);
assert.equal(invalid.status, 404);

const method = await worker.fetch(
  new Request('https://soloofertas-images.example.workers.dev/small/gdl/vacantes/image.jpg', { method: 'POST' }),
  env
);
assert.equal(method.status, 405);
assert.equal(method.headers.get('allow'), 'GET, HEAD');

const head = await worker.fetch(
  new Request('https://soloofertas-images.example.workers.dev/thumb/gdl/vacantes/image.jpg', { method: 'HEAD' }),
  env
);
assert.equal(head.status, 200);
assert.equal((await head.arrayBuffer()).byteLength, 0);

console.log('Worker: bindings privados R2/Images, presets, formatos y rutas cerradas OK');
