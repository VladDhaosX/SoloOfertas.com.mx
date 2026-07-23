const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { CONTENT_DIR } = require('./content-paths');

const BACKUPS_DIR = path.join(CONTENT_DIR, '.backups');
const JSON_BACKUP_RETENTION = 20;
const FILE_BACKUP_RETENTION = 200;

function assertInsideContent(filePath) {
  const relative = path.relative(CONTENT_DIR, path.resolve(filePath));
  if (relative === '' || relative === '.') return relative;
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Ruta fuera de CONTENT_DIR: ${filePath}`);
  }
  return relative;
}

function readJson(filePath) {
  assertInsideContent(filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function readJsonArray(filePath, options = {}) {
  let data;
  try {
    data = readJson(filePath);
  } catch (err) {
    if (err.code === 'ENOENT' && Object.prototype.hasOwnProperty.call(options, 'missing')) {
      return [...options.missing];
    }
    throw err;
  }
  if (!Array.isArray(data)) {
    throw new TypeError(`${filePath} debe contener un arreglo JSON`);
  }
  return data;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function jsonBackupDirectory(filePath) {
  const relative = assertInsideContent(filePath);
  return path.join(BACKUPS_DIR, 'json', path.dirname(relative));
}

function pruneJsonBackups(backupDir, basename) {
  const prefix = `${basename}.`;
  const backups = fs.readdirSync(backupDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.bak'))
    .map(entry => ({
      name: entry.name,
      path: path.join(backupDir, entry.name),
      mtimeMs: fs.statSync(path.join(backupDir, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const backup of backups.slice(JSON_BACKUP_RETENTION)) {
    fs.unlinkSync(backup.path);
  }
}

function backupJson(filePath) {
  if (!fs.existsSync(filePath)) return null;

  const backupDir = jsonBackupDirectory(filePath);
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `${path.basename(filePath)}.${timestamp()}-${randomUUID()}.bak`
  );
  fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
  pruneJsonBackups(backupDir, path.basename(filePath));
  return backupPath;
}

function writeJsonAtomic(filePath, data) {
  assertInsideContent(filePath);
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });

  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}-${randomUUID()}.tmp`);

  try {
    fs.writeFileSync(tempPath, serialized, { encoding: 'utf8', flag: 'wx' });
    // Comprueba que el archivo temporal sea JSON valido antes de publicarlo.
    JSON.parse(fs.readFileSync(tempPath, 'utf8'));
    backupJson(filePath);
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (_) {
      // Conservamos el error original.
    }
    throw err;
  }
}

function archiveFile(filePath) {
  assertInsideContent(filePath);
  if (!fs.existsSync(filePath)) return null;

  const relative = path.relative(CONTENT_DIR, filePath);
  const archiveDir = path.join(BACKUPS_DIR, 'files', path.dirname(relative));
  fs.mkdirSync(archiveDir, { recursive: true });
  const archivePath = path.join(
    archiveDir,
    `${timestamp()}-${randomUUID()}-${path.basename(filePath)}`
  );
  fs.renameSync(filePath, archivePath);

  const archivedFiles = fs.readdirSync(archiveDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => ({
      path: path.join(archiveDir, entry.name),
      mtimeMs: fs.statSync(path.join(archiveDir, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const archived of archivedFiles.slice(FILE_BACKUP_RETENTION)) {
    fs.unlinkSync(archived.path);
  }

  return archivePath;
}

module.exports = {
  BACKUPS_DIR,
  JSON_BACKUP_RETENTION,
  FILE_BACKUP_RETENTION,
  readJson,
  readJsonArray,
  writeJsonAtomic,
  archiveFile,
};
