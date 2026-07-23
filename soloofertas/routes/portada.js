const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const requireAuth = require('../middleware/auth');
const { dataPath, uploadsPath } = require('../content-paths');
const { readJson, writeJsonAtomic, archiveFile } = require('../content-store');

module.exports = function (region) {
  const router = express.Router();

  const uploadDir = uploadsPath(region, 'portadas');

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, `${randomUUID()}.jpg`);
    },
  });

  const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) {
        return cb(new Error('Solo se permiten imágenes'));
      }
      cb(null, true);
    },
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  router.post('/portada', requireAuth, upload.single('imagen'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió imagen' });
    }

    const ts = path.basename(req.file.filename, '.jpg');
    const url = `/${region}/uploads/portadas/${req.file.filename}`;
    const jsonPath = dataPath(region, 'portada.json');
    let previous = null;

    try {
      previous = readJson(jsonPath);
      writeJsonAtomic(jsonPath, { url, version: ts });
    } catch (err) {
      console.error('portada write error:', err);
      try { archiveFile(req.file.path); } catch (archiveErr) {
        console.error('portada rollback archive error:', archiveErr);
      }
      return res.status(500).json({ error: 'Error interno' });
    }

    if (previous && previous.url && previous.url !== url) {
      try {
        archiveFile(path.join(uploadDir, path.basename(previous.url)));
      } catch (err) {
        console.error('portada previous file archive error:', err);
      }
    }
    res.json({ url });
  });

  return router;
};
