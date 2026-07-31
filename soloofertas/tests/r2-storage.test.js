const assert = require('assert');
const { createR2Storage, mediaKey } = require('../services/r2-storage');

(async () => {
  const calls = [];
  const client = {
    async sign(url, options) {
      calls.push({ operation: 'sign', url: String(url), options });
      return new Request(`${url}&firma=ok`, { method: options.method, headers: options.headers });
    },
    async fetch(url, options) {
      calls.push({ operation: options.method, url: String(url), options });
      if (options.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '1234' },
        });
      }
      return new Response(null, { status: 204 });
    },
  };
  const workerCalls = [];
  const storage = createR2Storage({
    env: {
      MEDIA_STORAGE: 'r2',
      R2_ACCOUNT_ID: 'cuenta123',
      R2_BUCKET: 'soloofertas-media-prod',
      R2_ACCESS_KEY_ID: 'access-test',
      R2_SECRET_ACCESS_KEY: 'secret-test',
      MEDIA_DELIVERY_BASE_URL: 'https://soloofertas-images.example.workers.dev/',
    },
    client,
    uuid: () => '11111111-2222-4333-8444-555555555555',
    async fetchImpl(url, options) {
      workerCalls.push({ url: String(url), options });
      return new Response(null, { status: 200, headers: { 'Content-Type': 'image/webp' } });
    },
  });

  assert.equal(mediaKey('gdl', 'vacantes', 'imagen.jpg'), 'gdl/vacantes/imagen.jpg');
  assert.throws(() => mediaKey('gdl', 'vacantes', '../imagen.jpg'), /no permitido/);
  assert.throws(() => createR2Storage().assertConfigured(), /no esta habilitado/);

  const ticket = await storage.signUpload({
    region: 'gdl',
    type: 'vacantes',
    mime: 'image/jpeg',
    size: 1234,
  });
  assert.equal(ticket.key, 'gdl/vacantes/11111111-2222-4333-8444-555555555555.jpg');
  assert.match(ticket.uploadUrl, /X-Amz-Expires=300/);
  assert.equal(ticket.headers['Content-Type'], 'image/jpeg');
  assert.equal(calls[0].options.aws.signQuery, true);
  assert.equal(calls[0].options.aws.allHeaders, true);

  const media = await storage.completeUpload(ticket.key, 'gdl', 'vacantes');
  assert.equal(media.provider, 'r2');
  assert.equal(media.size, 1234);
  assert.equal(media.urls.small, `https://soloofertas-images.example.workers.dev/small/${ticket.key}`);
  assert.equal(media.urls.full, `https://soloofertas-images.example.workers.dev/full/${ticket.key}`);
  assert.equal(workerCalls[0].url, media.urls.admin);
  assert.equal(storage.publicUrl(media, 'vacantes'), media.urls.full);

  await storage.deleteKey(ticket.key);
  assert.equal(calls.at(-1).operation, 'DELETE');
  console.log('R2: firma directa, verificacion remota, URLs y eliminacion OK');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
