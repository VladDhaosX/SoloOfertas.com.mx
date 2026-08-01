const express = require('express');
const requireAuth = require('../middleware/auth');
const { MediaStorageError, createR2Storage, parseMediaKey } = require('../services/r2-storage');

module.exports = function (region, options = {}) {
  const router = express.Router();
  const storage = options.storage || createR2Storage();

  function respondError(res, err, context) {
    if (err instanceof MediaStorageError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(`${context} error:`, err);
    return res.status(500).json({ error: 'Error interno' });
  }

  router.post('/media/uploads', requireAuth, async (req, res) => {
    try {
      res.json(await storage.signUpload({ region, ...req.body }));
    } catch (err) {
      respondError(res, err, 'media presign');
    }
  });

  router.delete('/media/uploads', requireAuth, async (req, res) => {
    const keys = Array.isArray(req.body?.keys) ? req.body.keys : [req.body?.key].filter(Boolean);
    if (!keys.length || keys.length > 200) {
      return res.status(400).json({ error: 'Se requieren entre 1 y 200 claves' });
    }
    try {
      for (const key of keys) {
        if (parseMediaKey(key).region !== region) {
          throw new MediaStorageError('La imagen no pertenece a esta region', 400, 'MEDIA_PATH_INVALID');
        }
      }
      await Promise.allSettled(keys.map(key => storage.deleteKey(key)));
      res.json({ ok: true });
    } catch (err) {
      respondError(res, err, 'media cleanup');
    }
  });

  return router;
};
