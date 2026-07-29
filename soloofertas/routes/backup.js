const express = require('express');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const multer = require('multer');
const unzipper = require('unzipper');
const sharp = require('sharp');
const requireAuth = require('../middleware/auth');
const { CONTENT_DIR, REGIONS, contentPath, assertContentConfigured } = require('../content-paths');
const { BACKUPS_DIR } = require('../content-store');
const { beginMaintenance, endMaintenance } = require('../maintenance-state');
const site = require('../site-config');

const router = express.Router();
const CONTENT_PARENT = path.dirname(path.resolve(CONTENT_DIR));
const UPLOAD_ROOT = path.join(CONTENT_PARENT, '.soloofertas-restore-uploads');
const WORK_ROOT = path.join(CONTENT_PARENT, '.soloofertas-restore-work');
const RESTORE_ROOTS = new Set(['gdl/data', 'gdl/uploads', 'mty/data', 'mty/uploads']);
const REQUIRED_DATA = [
  'gdl/data/portada.json',
  'gdl/data/vacantes.json',
  'gdl/data/cupones.json',
  'mty/data/portada.json',
  'mty/data/vacantes.json',
];
const MAX_ZIP_BYTES = Number(process.env.BACKUP_MAX_ZIP_MB || 100) * 1024 * 1024;
const MAX_EXPANDED_BYTES = Number(process.env.BACKUP_MAX_EXPANDED_MB || 500) * 1024 * 1024;
const MAX_ENTRIES = 5000;
const RESTORE_RETENTION = 3;
let archiverModulePromise = null;

class RestoreValidationError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

function loadArchiver() {
  if (!archiverModulePromise) archiverModulePromise = import('archiver');
  return archiverModulePromise;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
      cb(null, UPLOAD_ROOT);
    },
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.zip`),
  }),
  fileFilter: (_req, file, cb) => {
    const zip = file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed' ||
      file.originalname.toLowerCase().endsWith('.zip');
    cb(zip ? null : new RestoreValidationError('Solo se permite un archivo ZIP'), zip);
  },
  limits: { fileSize: MAX_ZIP_BYTES, files: 1 },
});

function addDirectory(archive, sourcePath, zipPath) {
  if (!fs.existsSync(sourcePath)) return;
  for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
    if (entry.name === '.cache' || entry.name === '.backups') continue;
    const sourceEntry = path.join(sourcePath, entry.name);
    const zipEntry = `${zipPath}/${entry.name}`;
    if (entry.isDirectory()) addDirectory(archive, sourceEntry, zipEntry);
    else if (entry.isFile()) archive.file(sourceEntry, { name: zipEntry });
  }
}

function normalizeZipPath(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[a-z]:/i.test(raw)) return '';
  const parts = raw.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '.' || part === '..')) return '';
  return parts.join('/');
}

function restoreRoot(zipPath) {
  const parts = zipPath.split('/');
  if (parts.length < 2) return null;
  const root = `${parts[0]}/${parts[1]}`;
  return RESTORE_ROOTS.has(root) ? root : null;
}

function allowedRestoreFile(zipPath) {
  const root = restoreRoot(zipPath);
  if (!root || zipPath.includes('/.cache/')) return false;
  if (root.endsWith('/data')) return REQUIRED_DATA.includes(zipPath);
  return /\.(?:jpe?g|png|webp|gif)$/i.test(zipPath);
}

function entryExpandedSize(entry) {
  return Number(entry.uncompressedSize || entry.vars?.uncompressedSize || 0);
}

function validateDirectoryEntries(entries) {
  if (entries.length > MAX_ENTRIES) {
    throw new RestoreValidationError(`El ZIP excede el limite de ${MAX_ENTRIES} entradas`);
  }

  let declaredBytes = 0;
  const files = [];
  const seenPaths = new Set();
  for (const entry of entries) {
    const normalized = normalizeZipPath(entry.path);
    if (!normalized) throw new RestoreValidationError('El ZIP contiene una ruta invalida');
    if (!['File', 'Directory'].includes(entry.type)) {
      throw new RestoreValidationError(`Tipo de entrada no permitido: ${normalized}`);
    }
    if (entry.type === 'Directory' || normalized === 'backup-manifest.json' || normalized.startsWith('__MACOSX/')) {
      continue;
    }
    if (!allowedRestoreFile(normalized)) {
      throw new RestoreValidationError(`Ruta no permitida en ZIP: ${normalized}`);
    }
    if (seenPaths.has(normalized)) {
      throw new RestoreValidationError(`Ruta duplicada en ZIP: ${normalized}`);
    }
    seenPaths.add(normalized);
    declaredBytes += entryExpandedSize(entry);
    if (declaredBytes > MAX_EXPANDED_BYTES) {
      throw new RestoreValidationError('El contenido expandido excede el limite permitido');
    }
    files.push({ entry, path: normalized });
  }

  const included = new Set(files.map(file => file.path));
  const missing = REQUIRED_DATA.filter(required => !included.has(required));
  if (missing.length) {
    throw new RestoreValidationError(`El ZIP no contiene los datos requeridos: ${missing.join(', ')}`);
  }
  return files;
}

function resolveInside(root, relative) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relative);
  if (!target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new RestoreValidationError('El ZIP contiene una ruta fuera del destino permitido');
  }
  return target;
}

async function extractToStage(zipPath, stageRoot) {
  let directory;
  try {
    directory = await unzipper.Open.file(zipPath);
  } catch (_) {
    throw new RestoreValidationError('El archivo ZIP es invalido o esta dañado');
  }
  const files = validateDirectoryEntries(directory.files);
  let expandedBytes = 0;

  for (const file of files) {
    const target = resolveInside(stageRoot, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        expandedBytes += chunk.length;
        if (expandedBytes > MAX_EXPANDED_BYTES) {
          callback(new RestoreValidationError('El contenido expandido excede el limite permitido'));
        } else {
          callback(null, chunk);
        }
      },
    });
    try {
      await pipeline(file.entry.stream(), limiter, fs.createWriteStream(target, { flags: 'wx' }));
    } catch (err) {
      try { if (fs.existsSync(target)) fs.unlinkSync(target); } catch (_) {}
      if (err instanceof RestoreValidationError) throw err;
      throw new RestoreValidationError(`No se pudo extraer ${file.path}`);
    }
  }
  return files.length;
}

function assertJsonArray(filePath, label) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(data)) throw new RestoreValidationError(`${label} debe contener un arreglo JSON`);
  return data;
}

function referencedImage(stageRoot, region, type, url) {
  const expectedPrefix = `/${region}/uploads/${type}/`;
  if (typeof url !== 'string' || !url.startsWith(expectedPrefix)) {
    throw new RestoreValidationError(`URL de ${type} invalida para ${region}`);
  }
  const filename = path.basename(url);
  if (!filename || filename !== url.slice(expectedPrefix.length)) {
    throw new RestoreValidationError(`Nombre de imagen invalido para ${region}/${type}`);
  }
  const imagePath = resolveInside(stageRoot, `${region}/uploads/${type}/${filename}`);
  if (!fs.existsSync(imagePath)) {
    throw new RestoreValidationError(`Falta la imagen referenciada: ${region}/uploads/${type}/${filename}`);
  }
  return imagePath;
}

async function validateStage(stageRoot) {
  const referenced = new Set();
  for (const region of REGIONS) {
    const portadaPath = resolveInside(stageRoot, `${region}/data/portada.json`);
    let portada;
    try { portada = JSON.parse(fs.readFileSync(portadaPath, 'utf8')); } catch (_) {
      throw new RestoreValidationError(`portada.json invalido para ${region}`);
    }
    if (!portada || typeof portada !== 'object') {
      throw new RestoreValidationError(`portada.json invalido para ${region}`);
    }
    referenced.add(referencedImage(stageRoot, region, 'portadas', portada.url));

    const vacantes = assertJsonArray(
      resolveInside(stageRoot, `${region}/data/vacantes.json`),
      `vacantes.json de ${region}`
    );
    for (const item of vacantes) {
      if (!item || typeof item.id !== 'string') {
        throw new RestoreValidationError(`Oferta invalida en ${region}`);
      }
      referenced.add(referencedImage(stageRoot, region, 'vacantes', item.url));
    }
  }

  const cupones = assertJsonArray(
    resolveInside(stageRoot, 'gdl/data/cupones.json'),
    'cupones.json de gdl'
  );
  for (const item of cupones) {
    if (!item || typeof item.id !== 'string') throw new RestoreValidationError('Cupon invalido en gdl');
    referenced.add(referencedImage(stageRoot, 'gdl', 'cupones', item.url));
  }

  for (const imagePath of referenced) {
    try { await sharp(imagePath).metadata(); } catch (_) {
      throw new RestoreValidationError(`Imagen invalida: ${path.relative(stageRoot, imagePath)}`);
    }
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function pruneRestoreSnapshots() {
  const root = path.join(BACKUPS_DIR, 'restores');
  if (!fs.existsSync(root)) return;
  const snapshots = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      path: path.join(root, entry.name),
      mtimeMs: fs.statSync(path.join(root, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const snapshot of snapshots.slice(RESTORE_RETENTION)) {
    const relative = path.relative(root, snapshot.path);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    fs.rmSync(snapshot.path, { recursive: true, force: true });
  }
}

function installStage(stageRoot, workspaceRoot) {
  const snapshotRoot = path.join(BACKUPS_DIR, 'restores', `${timestamp()}-${randomUUID()}`);
  const installed = [];
  const archived = [];
  fs.mkdirSync(snapshotRoot, { recursive: true });

  try {
    for (const region of REGIONS) {
      const current = contentPath(region);
      const staged = path.join(stageRoot, region);
      const previous = path.join(snapshotRoot, region);
      if (!fs.existsSync(staged)) throw new Error(`Falta la region ${region} en staging`);
      if (fs.existsSync(current)) {
        fs.renameSync(current, previous);
        archived.push({ current, previous });
      }
      fs.renameSync(staged, current);
      installed.push(current);
    }
    pruneRestoreSnapshots();
    return path.basename(snapshotRoot);
  } catch (err) {
    const rollbackErrors = [];
    for (const current of [...installed].reverse()) {
      try {
        if (fs.existsSync(current)) {
          const failedRoot = path.join(workspaceRoot, 'failed');
          fs.mkdirSync(failedRoot, { recursive: true });
          fs.renameSync(current, path.join(failedRoot, path.basename(current)));
        }
      } catch (rollbackErr) { rollbackErrors.push(rollbackErr.message); }
    }
    for (const item of [...archived].reverse()) {
      try {
        if (fs.existsSync(item.previous)) fs.renameSync(item.previous, item.current);
      } catch (rollbackErr) { rollbackErrors.push(rollbackErr.message); }
    }
    if (rollbackErrors.length) err.message += `; rollback incompleto: ${rollbackErrors.join('; ')}`;
    throw err;
  }
}

function cleanupWorkspace(target, root) {
  if (!target || !fs.existsSync(target)) return;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
  fs.rmSync(resolved, { recursive: true, force: true });
}

router.get('/backup', requireAuth, async (_req, res) => {
  try {
    assertContentConfigured();
    const { ZipArchive } = await loadArchiver();
    const filename = `soloofertas-backup-${timestamp().slice(0, 19)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');

    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.on('error', err => {
      console.error('backup archive error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Error al generar backup' });
      else res.destroy(err);
    });
    archive.pipe(res);
    for (const region of REGIONS) {
      addDirectory(archive, contentPath(region, 'data'), `${region}/data`);
      addDirectory(archive, contentPath(region, 'uploads'), `${region}/uploads`);
    }
    archive.append(JSON.stringify({
      site: 'soloofertas',
      generatedAt: new Date().toISOString(),
      formatVersion: 1,
      excludes: ['.cache', '.backups'],
    }, null, 2), { name: 'backup-manifest.json' });
    archive.finalize();
  } catch (err) {
    console.error('backup start error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar backup' });
  }
});

router.post('/backup/restore', requireAuth, upload.single('backup'), async (req, res) => {
  if (!site.features.backupRestore) return res.status(404).json({ error: 'Ruta no encontrada' });
  if (!req.file) return res.status(400).json({ error: 'No se recibio archivo ZIP' });

  const operation = `restore:${randomUUID()}`;
  const workspace = path.join(WORK_ROOT, operation.replace(':', '-'));
  const stageRoot = path.join(workspace, 'stage');
  let maintenanceStarted = false;
  try {
    assertContentConfigured();
    fs.mkdirSync(stageRoot, { recursive: true });
    const files = await extractToStage(req.file.path, stageRoot);
    await validateStage(stageRoot);

    maintenanceStarted = beginMaintenance(operation);
    if (!maintenanceStarted) return res.status(409).json({ error: 'Otra operacion de mantenimiento esta en curso' });

    const snapshot = installStage(stageRoot, workspace);
    res.json({ ok: true, files, snapshot });
  } catch (err) {
    if (!(err instanceof RestoreValidationError)) console.error('backup restore error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'No se pudo restaurar el backup' });
  } finally {
    if (maintenanceStarted) endMaintenance(operation);
    try { if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch (_) {}
    cleanupWorkspace(workspace, WORK_ROOT);
  }
});

module.exports = router;
