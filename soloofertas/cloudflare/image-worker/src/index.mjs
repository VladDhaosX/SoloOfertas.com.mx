const PRESETS = Object.freeze({
  small: Object.freeze({ width: 360, fit: 'scale-down', quality: 64, format: 'auto' }),
  thumb: Object.freeze({ width: 640, fit: 'scale-down', quality: 68, format: 'auto' }),
  full: Object.freeze({ width: 1200, fit: 'scale-down', quality: 82, format: 'auto' }),
  cover: Object.freeze({ width: 720, fit: 'scale-down', quality: 76, format: 'auto' }),
  hero: Object.freeze({ width: 1280, fit: 'scale-down', quality: 72, format: 'auto' }),
  admin: Object.freeze({ width: 480, fit: 'scale-down', quality: 70, format: 'auto' }),
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

function originUrl(baseUrl, media) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base.startsWith('https://')) return null;
  const key = [media.region, media.type, media.filename].map(encodeURIComponent).join('/');
  return `${base}/${key}`;
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
    const source = originUrl(env.R2_PUBLIC_BASE_URL, media);
    if (!source) return errorResponse(503, 'Origen de imagenes no configurado');

    const transformed = await fetch(source, {
      cf: { image: PRESETS[media.preset] },
      headers: { Accept: request.headers.get('Accept') || 'image/avif,image/webp,image/*' },
    });
    if (!transformed.ok) {
      return errorResponse(transformed.status === 404 ? 404 : 502, 'Imagen no disponible');
    }

    const headers = new Headers(transformed.headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.delete('Set-Cookie');
    return new Response(request.method === 'HEAD' ? null : transformed.body, {
      status: transformed.status,
      headers,
    });
  },
};

export { PRESETS, TYPE_PRESETS, parseRequestPath };
