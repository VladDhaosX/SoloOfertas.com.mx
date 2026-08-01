const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const UPLOAD_EXPIRES_SECONDS = 300;
const REGIONS = new Set(['gdl', 'mty']);
const MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
});
const TYPE_PRESETS = Object.freeze({
  vacantes: Object.freeze(['small', 'thumb', 'full', 'admin']),
  portadas: Object.freeze(['cover', 'hero']),
  cupones: Object.freeze(['thumb', 'full', 'admin']),
});
const DEFAULT_PRESETS = Object.freeze({
  vacantes: 'full',
  portadas: 'cover',
  cupones: 'full',
});
const VERIFY_PRESETS = Object.freeze({
  vacantes: 'admin',
  portadas: 'cover',
  cupones: 'admin',
});
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const SAFE_BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

class MediaStorageError extends Error {
  constructor(message, statusCode = 500, code = 'MEDIA_STORAGE_ERROR') {
    super(message);
    this.name = 'MediaStorageError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanHttpsUrl(value) {
  const candidate = String(value || '').trim().replace(/\/+$/, '');
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.href.replace(/\/$/, '') : '';
  } catch (_) {
    return '';
  }
}

function readConfiguration(env) {
  const enabled = String(env.MEDIA_STORAGE || 'local').toLowerCase() === 'r2';
  const accountId = String(env.R2_ACCOUNT_ID || '').trim();
  const bucket = String(env.R2_BUCKET || '').trim();
  const accessKeyId = String(env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY || '').trim();
  const deliveryBaseUrl = cleanHttpsUrl(env.MEDIA_DELIVERY_BASE_URL);
  const endpoint = cleanHttpsUrl(env.R2_ENDPOINT) ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  return { enabled, accountId, bucket, accessKeyId, secretAccessKey, deliveryBaseUrl, endpoint };
}

function assertRegionType(region, type) {
  if (!REGIONS.has(region) || !TYPE_PRESETS[type] || (type === 'cupones' && region !== 'gdl')) {
    throw new MediaStorageError('Destino de imagen no permitido', 400, 'MEDIA_PATH_INVALID');
  }
}

function mediaKey(region, type, filename) {
  assertRegionType(region, type);
  if (!SAFE_FILENAME.test(String(filename || ''))) {
    throw new MediaStorageError('Nombre de imagen no permitido', 400, 'MEDIA_PATH_INVALID');
  }
  return `${region}/${type}/${filename}`;
}

function parseMediaKey(key) {
  const parts = String(key || '').split('/');
  if (parts.length !== 3) {
    throw new MediaStorageError('Clave de imagen no permitida', 400, 'MEDIA_PATH_INVALID');
  }
  const [region, type, filename] = parts;
  mediaKey(region, type, filename);
  return { region, type, filename };
}

function encodedKey(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

function createR2Storage({
  env = process.env,
  client = null,
  fetchImpl = globalThis.fetch,
  uuid = randomUUID,
} = {}) {
  const config = readConfiguration(env);
  let clientPromise;

  function assertConfigured() {
    if (!config.enabled) {
      throw new MediaStorageError('R2 no esta habilitado', 503, 'R2_DISABLED');
    }
    if (!config.accountId || !config.accessKeyId || !config.secretAccessKey ||
        !config.endpoint || !config.deliveryBaseUrl || !SAFE_BUCKET.test(config.bucket)) {
      throw new MediaStorageError('Configuracion R2 incompleta', 503, 'R2_CONFIGURATION_ERROR');
    }
  }

  async function signedClient() {
    assertConfigured();
    if (client) return client;
    if (!clientPromise) {
      clientPromise = import('aws4fetch').then(({ AwsClient }) => new AwsClient({
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        service: 's3',
        region: 'auto',
      }));
    }
    return clientPromise;
  }

  function objectUrl(key) {
    parseMediaKey(key);
    return `${config.endpoint}/${encodeURIComponent(config.bucket)}/${encodedKey(key)}`;
  }

  function descriptor(key, metadata = {}) {
    const { region, type } = parseMediaKey(key);
    const publicKey = encodedKey(key);
    const urls = Object.fromEntries(
      TYPE_PRESETS[type].map(preset => [preset, `${config.deliveryBaseUrl}/${preset}/${publicKey}`])
    );
    const size = Number(metadata.size);
    const mime = String(metadata.mime || '');
    return {
      provider: 'r2',
      key,
      urls,
      ...(MIME_EXTENSIONS[mime] ? { mime } : {}),
      ...(Number.isInteger(size) && size > 0 ? { size } : {}),
      region,
      type,
    };
  }

  async function signUpload({ region, type, mime, size }) {
    assertConfigured();
    assertRegionType(region, type);
    const normalizedMime = String(mime || '').toLowerCase();
    const bytes = Number(size);
    if (!MIME_EXTENSIONS[normalizedMime]) {
      throw new MediaStorageError('Solo se permiten imagenes JPEG, PNG o WebP', 400, 'MEDIA_TYPE_INVALID');
    }
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_UPLOAD_BYTES) {
      throw new MediaStorageError('La imagen debe pesar entre 1 byte y 10 MB', 400, 'MEDIA_SIZE_INVALID');
    }

    const key = mediaKey(region, type, `${uuid()}${MIME_EXTENSIONS[normalizedMime]}`);
    const url = new URL(objectUrl(key));
    url.searchParams.set('X-Amz-Expires', String(UPLOAD_EXPIRES_SECONDS));
    const headers = {
      'Content-Type': normalizedMime,
      'Cache-Control': 'public, max-age=31536000, immutable',
    };
    const request = await (await signedClient()).sign(url, {
      method: 'PUT',
      headers,
      aws: { signQuery: true, allHeaders: true },
    });
    return { key, uploadUrl: request.url, headers, expiresIn: UPLOAD_EXPIRES_SECONDS };
  }

  async function completeUpload(key, region, type) {
    assertConfigured();
    const parsed = parseMediaKey(key);
    if (parsed.region !== region || parsed.type !== type) {
      throw new MediaStorageError('La imagen no pertenece a esta seccion', 400, 'MEDIA_PATH_INVALID');
    }

    const response = await (await signedClient()).fetch(objectUrl(key), { method: 'HEAD' });
    if (!response.ok) {
      throw new MediaStorageError('La imagen no existe en R2', 400, 'R2_UPLOAD_MISSING');
    }
    const size = Number(response.headers.get('content-length'));
    const mime = String(response.headers.get('content-type') || '').split(';', 1)[0].toLowerCase();
    if (!Number.isInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES || !MIME_EXTENSIONS[mime] ||
        path.extname(parsed.filename).toLowerCase() !== MIME_EXTENSIONS[mime]) {
      throw new MediaStorageError('El objeto subido no es una imagen valida', 400, 'R2_UPLOAD_INVALID');
    }

    const media = descriptor(key, { size, mime });
    const verification = await fetchImpl(media.urls[VERIFY_PRESETS[type]], {
      method: 'HEAD',
      headers: { Accept: 'image/avif,image/webp,image/*' },
    });
    if (!verification.ok || !String(verification.headers.get('content-type') || '').startsWith('image/')) {
      throw new MediaStorageError('Cloudflare no pudo procesar la imagen', 400, 'R2_TRANSFORM_INVALID');
    }
    return media;
  }

  async function deleteKey(key) {
    assertConfigured();
    const response = await (await signedClient()).fetch(objectUrl(key), { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
      throw new MediaStorageError('No se pudo eliminar la imagen de R2', 502, 'R2_DELETE_FAILED');
    }
    return true;
  }

  async function deleteItem(item) {
    if (item?.media?.provider !== 'r2' || !item.media.key) return false;
    return deleteKey(item.media.key);
  }

  function publicUrl(media, type) {
    const preset = DEFAULT_PRESETS[type];
    return media?.provider === 'r2' && preset ? String(media.urls?.[preset] || '') : '';
  }

  async function uploadLocalFile(filePath, region, type, mime) {
    const stat = fs.statSync(filePath);
    const ticket = await signUpload({ region, type, mime, size: stat.size });
    try {
      const response = await fetchImpl(ticket.uploadUrl, {
        method: 'PUT',
        headers: ticket.headers,
        body: fs.readFileSync(filePath),
      });
      if (!response.ok) {
        throw new MediaStorageError('No se pudo migrar la imagen a R2', 502, 'R2_UPLOAD_FAILED');
      }
      return await completeUpload(ticket.key, region, type);
    } catch (err) {
      await deleteKey(ticket.key).catch(() => {});
      throw err;
    }
  }

  return {
    enabled: config.enabled,
    configured: config.enabled && Boolean(
      config.accountId && config.accessKeyId && config.secretAccessKey && config.endpoint &&
      config.deliveryBaseUrl && SAFE_BUCKET.test(config.bucket)
    ),
    assertConfigured,
    completeUpload,
    deleteItem,
    deleteKey,
    descriptor,
    publicUrl,
    signUpload,
    uploadLocalFile,
  };
}

module.exports = {
  DEFAULT_PRESETS,
  MAX_UPLOAD_BYTES,
  MIME_EXTENSIONS,
  MediaStorageError,
  TYPE_PRESETS,
  createR2Storage,
  mediaKey,
  parseMediaKey,
};
