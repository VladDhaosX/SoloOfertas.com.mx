const PRESETS = Object.freeze({
  small: Object.freeze({ width: 360, fit: 'scale-down', quality: 64 }),
  thumb: Object.freeze({ width: 640, fit: 'scale-down', quality: 68 }),
  full: Object.freeze({ width: 1200, fit: 'scale-down', quality: 82 }),
  cover: Object.freeze({ width: 720, fit: 'scale-down', quality: 76 }),
  hero: Object.freeze({ width: 1280, fit: 'scale-down', quality: 72 }),
  admin: Object.freeze({ width: 480, fit: 'scale-down', quality: 70 }),
});

const TYPE_PRESETS = Object.freeze({
  vacantes: new Set(['small', 'thumb', 'full', 'admin']),
  portadas: new Set(['cover', 'hero']),
  cupones: new Set(['thumb', 'full', 'admin']),
});
const REGIONS = new Set(['gdl', 'mty']);
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function parseRequestPath(pathname) {
  let parts;
  try { parts = pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch (_) { return null; }
  if (parts.length !== 4) return null;
  const [preset, region, type, filename] = parts;
  if (!PRESETS[preset] || !REGIONS.has(region) || !TYPE_PRESETS[type]?.has(preset)) return null;
  if (type === 'cupones' && region !== 'gdl') return null;
  if (!SAFE_FILENAME.test(filename)) return null;
  return { preset, region, type, filename };
}

function objectKey(media) {
  return [media.region, media.type, media.filename].join('/');
}

function responseFormat(acceptHeader, sourceContentType) {
  const accept = String(acceptHeader || '').toLowerCase();
  if (accept.includes('image/avif')) return 'image/avif';
  if (accept.includes('image/webp')) return 'image/webp';

  const source = String(sourceContentType || '').toLowerCase().split(';', 1)[0].trim();
  return ['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(source)
    ? source
    : 'image/jpeg';
}

function bindingsAvailable(env) {
  return typeof env?.MEDIA_BUCKET?.get === 'function' && typeof env?.IMAGES?.input === 'function';
}

export default {
  async fetch(request, env) {
    if (!['GET', 'HEAD'].includes(request.method)) {
      const response = errorResponse(405, 'Metodo no permitido');
      response.headers.set('Allow', 'GET, HEAD');
      return response;
    }

    const media = parseRequestPath(new URL(request.url).pathname);
    if (!media) return errorResponse(404, 'Variante no encontrada');
    if (!bindingsAvailable(env)) return errorResponse(503, 'Bindings de imagenes no configurados');

    let original;
    try {
      original = await env.MEDIA_BUCKET.get(objectKey(media));
    } catch (_) {
      return errorResponse(502, 'No se pudo leer la imagen');
    }
    if (!original?.body) return errorResponse(404, 'Imagen no disponible');

    const { quality, ...transform } = PRESETS[media.preset];
    const format = responseFormat(request.headers.get('Accept'), original.httpMetadata?.contentType);
    let transformed;
    try {
      const output = await env.IMAGES.input(original.body)
        .transform(transform)
        .output({ format, quality });
      transformed = output.response();
    } catch (_) {
      return errorResponse(502, 'Cloudflare no pudo transformar la imagen');
    }
    if (!transformed.ok) return errorResponse(502, 'Imagen no disponible');

    const headers = new Headers(transformed.headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Vary', 'Accept');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.delete('Set-Cookie');
    return new Response(request.method === 'HEAD' ? null : transformed.body, {
      status: transformed.status,
      headers,
    });
  },
};

export { PRESETS, TYPE_PRESETS, objectKey, parseRequestPath, responseFormat };
