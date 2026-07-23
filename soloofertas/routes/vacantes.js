const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const requireAuth = require('../middleware/auth');
const { dataPath, uploadsPath } = require('../content-paths');
const { readJsonArray, writeJsonAtomic, archiveFile } = require('../content-store');

module.exports = function (region) {
  const router = express.Router();

  const uploadDir = uploadsPath(region, 'vacantes');
  const jsonPath = dataPath(region, 'vacantes.json');

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

  function readVacantes() {
    return readJsonArray(jsonPath);
  }

  function writeVacantes(data) {
    writeJsonAtomic(jsonPath, data);
  }

  function archiveUploads(files) {
    for (const file of files || []) {
      try { archiveFile(file.path); } catch (err) {
        console.error('vacantes uploaded file archive error:', err);
      }
    }
  }

  function archivePublishedItem(item) {
    const filename = path.basename(item.url);
    try { archiveFile(path.join(uploadDir, filename)); } catch (err) {
      console.error('vacantes published file archive error:', err);
    }
  }

  router.post('/vacantes/replace-all', requireAuth, upload.array('imagenes', 200), (req, res) => {
    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: 'No se recibieron imágenes' });
    }

    try {
      const existing = readVacantes();
      // Build new list from uploaded files (already sorted client-side).
      const now = new Date().toISOString().slice(0, 10);
      const lista = req.files.map(file => {
        const id = randomUUID();
        const url = `/${region}/uploads/vacantes/${file.filename}`;
        return { id, url, fecha: now, rotation: 0, telefono: '' };
      });

      writeVacantes(lista);
      existing.forEach(archivePublishedItem);
      res.json({ total: lista.length });
    } catch (err) {
      console.error('vacantes replace-all error:', err);
      archiveUploads(req.files);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  router.post('/vacantes', requireAuth, upload.single('imagen'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió imagen' });
    }

    const id = randomUUID();
    const url = `/${region}/uploads/vacantes/${req.file.filename}`;
    const now = new Date().toISOString().slice(0, 10);

    try {
      const lista = readVacantes();
      const item = { id, url, fecha: now, rotation: 0, telefono: '' };
      lista.unshift(item);
      writeVacantes(lista);
      res.json({ id, url });
    } catch (err) {
      console.error('vacantes write error:', err);
      archiveUploads([req.file]);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  router.put('/vacantes/reorder', requireAuth, (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids debe ser array' });
    try {
      const lista = readVacantes();
      const map = Object.fromEntries(lista.map(v => [v.id, v]));
      const reordered = ids.map(id => map[id]).filter(Boolean);
      const missing = lista.filter(v => !ids.includes(v.id));
      writeVacantes([...reordered, ...missing]);
      res.json({ ok: true });
    } catch (err) {
      console.error('vacantes reorder error:', err);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  router.put('/vacantes/:id/telefono', requireAuth, (req, res) => {
    const { id } = req.params;
    const telefono = String(req.body.telefono || '').trim();
    if (telefono.length > 30) {
      return res.status(400).json({ error: 'El numero no debe exceder 30 caracteres' });
    }

    try {
      const lista = readVacantes();
      const item = lista.find(v => v.id === id);
      if (!item) return res.status(404).json({ error: 'Oferta no encontrada' });
      item.telefono = telefono;
      writeVacantes(lista);
      res.json({ ok: true, telefono });
    } catch (err) {
      console.error('vacantes telefono error:', err);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  router.delete('/vacantes/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    try {
      const lista = readVacantes();
      const item = lista.find(v => v.id === id);
      if (!item) {
        return res.status(404).json({ error: 'Oferta no encontrada' });
      }

      const filtered = lista.filter(v => v.id !== id);
      writeVacantes(filtered);
      archivePublishedItem(item);

      res.json({ ok: true });
    } catch (err) {
      console.error('vacantes delete error:', err);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  return router;
};
