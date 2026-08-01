const express = require('express');
const path = require('path');
const requireAuth = require('../middleware/auth');
const { dataPath } = require('../content-paths');
const { readJson, writeJsonAtomic } = require('../content-store');
const { MediaStorageError, createR2Storage } = require('../services/r2-storage');

module.exports = function (region, options = {}) {
  const router = express.Router();
  const storage = options.storage || createR2Storage();
  const jsonPath = dataPath(region, 'portada.json');

  router.post('/portada', requireAuth, async (req, res) => {
    const key = req.body?.key;
    try {
      const media = await storage.completeUpload(key, region, 'portadas');
      const previous = readJson(jsonPath);
      const url = storage.publicUrl(media, 'portadas');
      writeJsonAtomic(jsonPath, { url, version: path.parse(media.key).name, media });

      if (previous?.url && previous.url !== url) {
        try { await storage.deleteItem(previous); } catch (err) {
          console.error('portada previous R2 cleanup error:', err);
        }
      }
      res.json({ url, media });
    } catch (err) {
      if (key) await storage.deleteKey(key).catch(() => {});
      if (err instanceof MediaStorageError) return res.status(err.statusCode).json({ error: err.message });
      console.error('portada write error:', err);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  return router;
};
