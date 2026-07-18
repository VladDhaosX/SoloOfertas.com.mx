const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const requireAuth = require('../middleware/auth');
const { dataPath, uploadsPath } = require('../content-paths');

module.exports = function (region) {
  const router = express.Router();

  const uploadDir = uploadsPath(region, 'portadas');

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const ts = Date.now().toString();
      cb(null, `${ts}.jpg`);
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

    try {
      fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
      fs.writeFileSync(jsonPath, JSON.stringify({ url, version: ts }, null, 2));
      res.json({ url });
    } catch (err) {
      console.error('portada write error:', err);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  return router;
};
