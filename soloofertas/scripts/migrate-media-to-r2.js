const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.MEDIA_STORAGE = 'r2';
const { CONTENT_DIR, REGIONS, dataPath, uploadsPath } = require('../content-paths');
const { readJson, readJsonArray, writeJsonAtomic } = require('../content-store');
const { createR2Storage } = require('../services/r2-storage');

const DELETE_LOCAL = process.argv.includes('--delete-local');
const MIME_BY_EXTENSION = Object.freeze({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
});

function localSource(region, type, url) {
  const filename = path.basename(String(url || ''));
  const mime = MIME_BY_EXTENSION[path.extname(filename).toLowerCase()];
  const source = uploadsPath(region, type, filename);
  if (!filename || !mime || !fs.existsSync(source)) {
    throw new Error(`Falta la imagen local ${region}/${type}/${filename || '(sin nombre)'}`);
  }
  return { source, mime };
}

function removeLocalUploads() {
  for (const region of REGIONS) {
    for (const type of ['vacantes', 'portadas', ...(region === 'gdl' ? ['cupones'] : [])]) {
      const target = path.resolve(uploadsPath(region, type));
      const relative = path.relative(path.resolve(CONTENT_DIR), target);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Ruta de limpieza no permitida: ${target}`);
      }
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    }
  }
}

async function run() {
  const storage = createR2Storage();
  storage.assertConfigured();
  const uploaded = [];
  const documents = [];
  let published = false;

  async function migrateItem(item, region, type) {
    if (item?.media?.provider === 'r2') return item;
    const { source, mime } = localSource(region, type, item?.url);
    const media = await storage.uploadLocalFile(source, region, type, mime);
    uploaded.push(media);
    console.log(`R2 ${uploaded.length}: ${media.key}`);
    return { ...item, url: storage.publicUrl(media, type), media };
  }

  try {
    for (const region of REGIONS) {
      const portadaPath = dataPath(region, 'portada.json');
      const portada = readJson(portadaPath);
      documents.push({
        path: portadaPath,
        original: portada,
        migrated: await migrateItem(portada, region, 'portadas'),
      });

      const vacantesPath = dataPath(region, 'vacantes.json');
      const vacantes = readJsonArray(vacantesPath);
      const migratedVacantes = [];
      for (const item of vacantes) migratedVacantes.push(await migrateItem(item, region, 'vacantes'));
      documents.push({ path: vacantesPath, original: vacantes, migrated: migratedVacantes });
    }

    const cuponesPath = dataPath('gdl', 'cupones.json');
    const cupones = readJsonArray(cuponesPath);
    const migratedCupones = [];
    for (const item of cupones) migratedCupones.push(await migrateItem(item, 'gdl', 'cupones'));
    documents.push({ path: cuponesPath, original: cupones, migrated: migratedCupones });

    const written = [];
    try {
      for (const document of documents) {
        writeJsonAtomic(document.path, document.migrated);
        written.push(document);
      }
    } catch (err) {
      for (const document of written.reverse()) writeJsonAtomic(document.path, document.original);
      throw err;
    }

    published = true;
    if (DELETE_LOCAL) removeLocalUploads();
    console.log(`Migracion completa: ${uploaded.length} imagenes${DELETE_LOCAL ? '; archivos locales eliminados' : ''}.`);
  } catch (err) {
    if (!published) await Promise.allSettled(uploaded.map(media => storage.deleteKey(media.key)));
    throw err;
  }
}

run().catch(err => {
  console.error(err.message || err);
  process.exitCode = 1;
});
