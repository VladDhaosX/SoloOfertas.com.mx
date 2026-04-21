const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const requireAuth = require('../middleware/auth');

const ROOT = path.join(__dirname, '..', 'pages');

module.exports = function (region) {
  const router = express.Router();

  const uploadDir = path.join(ROOT, region, 'uploads', 'vacantes');
  const jsonPath = path.join(ROOT, region, 'data', 'vacantes.json');

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

  function readVacantes() {
    try {
      return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (_) {
      return [];
    }
  }

  function writeVacantes(data) {
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  }

  router.post('/vacantes', requireAuth, upload.single('imagen'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió imagen' });
    }

    const ts = Date.now().toString();
    const url = `/${region}/uploads/vacantes/${req.file.filename}`;
    const now = new Date().toISOString().slice(0, 10);

    try {
      const lista = readVacantes();
      const item = { id: ts, url, fecha: now };
      lista.unshift(item);
      writeVacantes(lista);
      res.json({ id: ts, url });
    } catch (err) {
      console.error('vacantes write error:', err);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  router.delete('/vacantes/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    try {
      const lista = readVacantes();
      const item = lista.find(v => v.id === id);
      if (!item) {
        return res.status(404).json({ error: 'Vacante no encontrada' });
      }

      const filtered = lista.filter(v => v.id !== id);
      writeVacantes(filtered);

      // Delete file if it exists within the uploads dir
      const filename = path.basename(item.url);
      const filepath = path.join(uploadDir, filename);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('vacantes delete error:', err);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  return router;
};
