const express = require('express');
const { randomUUID } = require('crypto');
const requireAuth = require('../middleware/auth');
const { dataPath } = require('../content-paths');
const { readJsonArray, writeJsonAtomic } = require('../content-store');
const { MediaStorageError, createR2Storage } = require('../services/r2-storage');

module.exports = function (region, options = {}) {
  const router = express.Router();
  const jsonPath = dataPath(region, 'vacantes.json');
  const storage = options.storage || createR2Storage();

  const readVacantes = () => readJsonArray(jsonPath);
  const writeVacantes = data => writeJsonAtomic(jsonPath, data);

  function respondError(res, err, context) {
    if (err instanceof MediaStorageError) return res.status(err.statusCode).json({ error: err.message });
    console.error(`${context} error:`, err);
    return res.status(500).json({ error: 'Error interno' });
  }

  async function deletePublishedItem(item) {
    try { await storage.deleteItem(item); } catch (err) {
      console.error('vacantes R2 cleanup error:', err);
    }
  }

  router.post('/vacantes/replace-all', requireAuth, async (req, res) => {
    const keys = req.body?.keys;
    if (!Array.isArray(keys) || !keys.length || keys.length > 200 || new Set(keys).size !== keys.length) {
      return res.status(400).json({ error: 'Se requieren entre 1 y 200 imagenes distintas' });
    }

    try {
      const stored = [];
      for (const key of keys) stored.push(await storage.completeUpload(key, region, 'vacantes'));

      const existing = readVacantes();
      const today = new Date().toISOString().slice(0, 10);
      const items = stored.map(media => ({
        id: randomUUID(),
        url: storage.publicUrl(media, 'vacantes'),
        fecha: today,
        rotation: 0,
        telefono: '',
        media,
      }));
      writeVacantes(items);
      for (const item of existing) await deletePublishedItem(item);
      res.json({ ok: true, total: items.length });
    } catch (err) {
      await Promise.allSettled(keys.map(key => storage.deleteKey(key)));
      respondError(res, err, 'vacantes replace-all');
    }
  });

  router.post('/vacantes', requireAuth, async (req, res) => {
    const key = req.body?.key;
    try {
      const media = await storage.completeUpload(key, region, 'vacantes');
      const item = {
        id: randomUUID(),
        url: storage.publicUrl(media, 'vacantes'),
        fecha: new Date().toISOString().slice(0, 10),
        rotation: 0,
        telefono: '',
        media,
      };
      const items = readVacantes();
      items.unshift(item);
      writeVacantes(items);
      res.json(item);
    } catch (err) {
      if (key) await storage.deleteKey(key).catch(() => {});
      respondError(res, err, 'vacantes write');
    }
  });

  router.put('/vacantes/reorder', requireAuth, (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids debe ser array' });
    try {
      const items = readVacantes();
      const map = Object.fromEntries(items.map(item => [item.id, item]));
      const included = new Set(ids);
      writeVacantes([...ids.map(id => map[id]).filter(Boolean), ...items.filter(item => !included.has(item.id))]);
      res.json({ ok: true });
    } catch (err) {
      respondError(res, err, 'vacantes reorder');
    }
  });

  router.put('/vacantes/:id/rotate', requireAuth, (req, res) => {
    try {
      const items = readVacantes();
      const item = items.find(vacante => vacante.id === req.params.id);
      if (!item) return res.status(404).json({ error: 'Oferta no encontrada' });
      item.rotation = ((Number(item.rotation) || 0) + 90) % 360;
      writeVacantes(items);
      res.json({ ok: true, rotation: item.rotation });
    } catch (err) {
      respondError(res, err, 'vacantes rotate');
    }
  });

  router.put('/vacantes/:id/telefono', requireAuth, (req, res) => {
    const telefono = String(req.body.telefono || '').trim();
    if (telefono.length > 30) {
      return res.status(400).json({ error: 'El numero no debe exceder 30 caracteres' });
    }
    try {
      const items = readVacantes();
      const item = items.find(vacante => vacante.id === req.params.id);
      if (!item) return res.status(404).json({ error: 'Oferta no encontrada' });
      item.telefono = telefono;
      writeVacantes(items);
      res.json({ ok: true, telefono });
    } catch (err) {
      respondError(res, err, 'vacantes telefono');
    }
  });

  router.delete('/vacantes/:id', requireAuth, async (req, res) => {
    try {
      const items = readVacantes();
      const item = items.find(vacante => vacante.id === req.params.id);
      if (!item) return res.status(404).json({ error: 'Oferta no encontrada' });
      writeVacantes(items.filter(vacante => vacante.id !== req.params.id));
      await deletePublishedItem(item);
      res.json({ ok: true });
    } catch (err) {
      respondError(res, err, 'vacantes delete');
    }
  });

  return router;
};
