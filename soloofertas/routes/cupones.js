const express = require('express');
const { randomUUID } = require('crypto');
const requireAuth = require('../middleware/auth');
const { dataPath } = require('../content-paths');
const { readJsonArray, writeJsonAtomic } = require('../content-store');
const { MediaStorageError, createR2Storage } = require('../services/r2-storage');

module.exports = function (region, options = {}) {
  const router = express.Router();
  const jsonPath = dataPath(region, 'cupones.json');
  const storage = options.storage || createR2Storage();

  const readCupones = () => readJsonArray(jsonPath);
  const writeCupones = data => writeJsonAtomic(jsonPath, data);
  const newCupon = media => ({
    id: randomUUID(),
    url: storage.publicUrl(media, 'cupones'),
    fecha: new Date().toISOString().slice(0, 10),
    rotation: 0,
    media,
  });

  function respondError(res, err, context) {
    if (err instanceof MediaStorageError) return res.status(err.statusCode).json({ error: err.message });
    console.error(`${context} error:`, err);
    return res.status(500).json({ error: 'Error interno' });
  }

  async function deletePublishedItem(item) {
    try { await storage.deleteItem(item); } catch (err) {
      console.error('cupones R2 cleanup error:', err);
    }
  }

  router.post('/cupones/replace-all', requireAuth, async (req, res) => {
    const keys = req.body?.keys;
    if (!Array.isArray(keys) || !keys.length || keys.length > 200 || new Set(keys).size !== keys.length) {
      return res.status(400).json({ error: 'Se requieren entre 1 y 200 imagenes distintas' });
    }
    try {
      const stored = [];
      for (const key of keys) stored.push(await storage.completeUpload(key, region, 'cupones'));
      const existing = readCupones();
      const items = stored.map(newCupon);
      writeCupones(items);
      for (const item of existing) await deletePublishedItem(item);
      res.json({ ok: true, total: items.length });
    } catch (err) {
      await Promise.allSettled(keys.map(key => storage.deleteKey(key)));
      respondError(res, err, 'cupones replace-all');
    }
  });

  router.post('/cupones', requireAuth, async (req, res) => {
    const key = req.body?.key;
    try {
      const media = await storage.completeUpload(key, region, 'cupones');
      const item = newCupon(media);
      const items = readCupones();
      items.unshift(item);
      writeCupones(items);
      res.json(item);
    } catch (err) {
      if (key) await storage.deleteKey(key).catch(() => {});
      respondError(res, err, 'cupones write');
    }
  });

  router.put('/cupones/reorder', requireAuth, (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids debe ser un array' });
    try {
      const items = readCupones();
      const map = new Map(items.map(item => [item.id, item]));
      const included = new Set(ids);
      writeCupones([...ids.map(id => map.get(id)).filter(Boolean), ...items.filter(item => !included.has(item.id))]);
      res.json({ ok: true });
    } catch (err) {
      respondError(res, err, 'cupones reorder');
    }
  });

  router.put('/cupones/:id/rotate', requireAuth, (req, res) => {
    try {
      const items = readCupones();
      const item = items.find(cupon => cupon.id === req.params.id);
      if (!item) return res.status(404).json({ error: 'Cupon no encontrado' });
      item.rotation = ((Number(item.rotation) || 0) + 90) % 360;
      writeCupones(items);
      res.json({ ok: true, rotation: item.rotation });
    } catch (err) {
      respondError(res, err, 'cupones rotate');
    }
  });

  router.delete('/cupones/:id', requireAuth, async (req, res) => {
    try {
      const items = readCupones();
      const item = items.find(cupon => cupon.id === req.params.id);
      if (!item) return res.status(404).json({ error: 'Cupon no encontrado' });
      writeCupones(items.filter(cupon => cupon.id !== req.params.id));
      await deletePublishedItem(item);
      res.json({ ok: true });
    } catch (err) {
      respondError(res, err, 'cupones delete');
    }
  });

  return router;
};
