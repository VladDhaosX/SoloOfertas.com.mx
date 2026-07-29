const express = require('express');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const sharp = require('sharp');
const { uploadsPath } = require('../content-paths');
const site = require('../site-config');

const router = express.Router();
const REGIONS = new Set(['gdl', 'mty']);
const TYPES = new Set(['vacantes', 'portadas', 'cupones']);
const PRESETS = Object.freeze({
  small: Object.freeze({ width: 360, quality: 64 }),
  thumb: Object.freeze({ width: 640, quality: 68 }),
  full: Object.freeze({ width: 1200, quality: 82 }),
  cover: Object.freeze({ width: 720, quality: 76 }),
  hero: Object.freeze({ width: 1280, quality: 72 }),
  admin: Object.freeze({ width: 480, quality: 70 }),
});
const inFlight = new Map();

// Reduce los picos de memoria en planes de hosting con recursos limitados.
sharp.cache({ files: 0 });
sharp.concurrency(1);

function safeFilename(value) {
  const original = String(value || '');
  const filename = path.basename(original);
  return filename && filename === original ? filename : '';
}

function resolveUploadPath(region, type, filename) {
  if (!REGIONS.has(region) || !TYPES.has(type)) return null;
  if (type === 'cupones' && region !== 'gdl') return null;

  const safeName = safeFilename(filename);
  if (!safeName) return null;

  const root = path.resolve(uploadsPath(region, type));
  const target = path.resolve(root, safeName);
  if (!target.startsWith(`${root}${path.sep}`)) return null;
  return target;
}

function cachePathFor(source, filename, presetName) {
  const stat = fs.statSync(source);
  const cacheDir = path.join(path.dirname(source), '.cache');
  const sourceKey = Buffer.from(filename).toString('hex');
  const cacheName = `${sourceKey}-${stat.size}-${Math.floor(stat.mtimeMs)}-${presetName}.webp`;
  return { cacheDir, cachePath: path.join(cacheDir, cacheName) };
}

async function createVariant(source, filename, presetName) {
  const preset = PRESETS[presetName];
  const { cacheDir, cachePath } = cachePathFor(source, filename, presetName);
  if (fs.existsSync(cachePath)) return cachePath;

  if (inFlight.has(cachePath)) return inFlight.get(cachePath);

  const generation = (async () => {
    fs.mkdirSync(cacheDir, { recursive: true });
    const tempPath = path.join(cacheDir, `.${path.basename(cachePath)}.${randomUUID()}.tmp`);
    try {
      await sharp(source)
        .rotate()
        .resize({ width: preset.width, withoutEnlargement: true })
        .webp({ quality: preset.quality })
        .toFile(tempPath);
      fs.renameSync(tempPath, cachePath);
      return cachePath;
    } catch (err) {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
      throw err;
    }
  })();

  inFlight.set(cachePath, generation);
  try {
    return await generation;
  } finally {
    inFlight.delete(cachePath);
  }
}

router.get('/media/:region/:type/:filename', async (req, res) => {
  const { region, type, filename } = req.params;
  if (type === 'cupones' && !site.features.coupons) return res.status(404).end();
  const presetName = String(req.query.preset || 'thumb');
  if (!Object.prototype.hasOwnProperty.call(PRESETS, presetName)) {
    return res.status(400).json({ error: 'Preset de imagen no permitido' });
  }

  const source = resolveUploadPath(region, type, filename);
  if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
    return res.status(404).end();
  }

  try {
    const optimized = await createVariant(source, filename, presetName);
    res.type('image/webp');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(optimized);
  } catch (err) {
    console.error('optimized media error:', err);
    res.set('Cache-Control', 'public, max-age=3600');
    res.sendFile(source);
  }
});

router.PRESETS = PRESETS;
module.exports = router;
