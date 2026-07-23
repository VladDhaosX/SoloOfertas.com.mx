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
  const uploadDir = uploadsPath(region, 'cupones');
  const jsonPath = dataPath(region, 'cupones.json');

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        const ext = file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.jpg';
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
    limits: { fileSize: 10 * 1024 * 1024, files: 200 },
  });

  function readCupones() {
    return readJsonArray(jsonPath);
  }

  function writeCupones(data) {
    writeJsonAtomic(jsonPath, data);
  }

  function archiveUploads(files) {
    for (const file of files || []) {
      try { archiveFile(file.path); } catch (err) {
        console.error('cupones uploaded file archive error:', err);
      }
    }
  }

  function archivePublishedItem(item) {
    try { archiveFile(path.join(uploadDir, path.basename(item.url))); } catch (err) {
      console.error('cupones published file archive error:', err);
    }
  }

  function newCupon(file) {
    return {
      id: randomUUID(),
      url: `/${region}/uploads/cupones/${file.filename}`,
      fecha: new Date().toISOString().slice(0, 10),
      rotation: 0,
    };
  }

  router.post('/cupones/replace-all', requireAuth, upload.array('imagenes', 200), (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No se recibieron imágenes' });

    try {
      const existing = readCupones();
      const lista = files.map(newCupon);
      writeCupones(lista);
      existing.forEach(archivePublishedItem);
      res.json({ ok: true, total: lista.length });
    } catch (err) {
      console.error('cupones replace-all error:', err);
      archiveUploads(files);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  router.post('/cupones', requireAuth, upload.single('imagen'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
    try {
      const lista = readCupones();
      const item = newCupon(req.file);
      lista.unshift(item);
      writeCupones(lista);
      res.json(item);
    } catch (err) {
      console.error('cupones write error:', err);
      archiveUploads([req.file]);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  router.put('/cupones/reorder', requireAuth, (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids debe ser un array' });
    try {
      const lista = readCupones();
      const map = new Map(lista.map(item => [item.id, item]));
      const included = new Set(ids);
      writeCupones([...ids.map(id => map.get(id)).filter(Boolean), ...lista.filter(item => !included.has(item.id))]);
      res.json({ ok: true });
    } catch (err) {
      console.error('cupones reorder error:', err);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  router.put('/cupones/:id/rotate', requireAuth, (req, res) => {
    try {
      const lista = readCupones();
      const item = lista.find(cupon => cupon.id === req.params.id);
      if (!item) return res.status(404).json({ error: 'Cupón no encontrado' });
      item.rotation = ((item.rotation || 0) + 90) % 360;
      writeCupones(lista);
      res.json({ ok: true, rotation: item.rotation });
    } catch (err) {
      console.error('cupones rotate error:', err);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  router.delete('/cupones/:id', requireAuth, (req, res) => {
    try {
      const lista = readCupones();
      const item = lista.find(cupon => cupon.id === req.params.id);
      if (!item) return res.status(404).json({ error: 'Cupón no encontrado' });
      writeCupones(lista.filter(cupon => cupon.id !== req.params.id));
      archivePublishedItem(item);
      res.json({ ok: true });
    } catch (err) {
      console.error('cupones delete error:', err);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  return router;
};
