const fs = require('fs');
const path = require('path');

const APP_ROOT = __dirname;
const PAGES_DIR = path.join(APP_ROOT, 'pages');
const STORAGE_DIR = path.join(APP_ROOT, 'storage');
const REGIONS = ['gdl', 'mty'];
const REQUIRED_DATA_FILES = {
  gdl: ['portada.json', 'vacantes.json', 'cupones.json'],
  mty: ['portada.json', 'vacantes.json'],
};
const configuredContentDir = String(process.env.CONTENT_DIR || '').trim();

function isSameOrInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

if (process.env.NODE_ENV === 'production' && !configuredContentDir) {
  throw new Error(
    'CONTENT_DIR es obligatorio en produccion y debe apuntar a almacenamiento persistente fuera del checkout.'
  );
}

// El contenido editable nunca debe caer silenciosamente dentro de pages/.
// Desarrollo usa storage/ y produccion exige una ruta persistente explicita.
const CONTENT_DIR = configuredContentDir
  ? path.resolve(APP_ROOT, configuredContentDir)
  : STORAGE_DIR;

if (isSameOrInside(PAGES_DIR, CONTENT_DIR)) {
  throw new Error('CONTENT_DIR no puede apuntar a pages/ porque contiene el snapshot versionado de solo lectura.');
}

if (process.env.NODE_ENV === 'production' && isSameOrInside(path.dirname(APP_ROOT), CONTENT_DIR)) {
  throw new Error('CONTENT_DIR debe estar fuera del checkout cuando NODE_ENV=production.');
}

function dataPath(region, filename) {
  return path.join(CONTENT_DIR, region, 'data', filename);
}

function uploadsPath(region, type, filename = '') {
  return path.join(CONTENT_DIR, region, 'uploads', type, filename);
}

function missingContentFiles() {
  const missing = [];
  for (const region of REGIONS) {
    for (const filename of REQUIRED_DATA_FILES[region]) {
      const file = dataPath(region, filename);
      if (!fs.existsSync(file)) missing.push(path.relative(CONTENT_DIR, file));
    }
  }
  return missing;
}

function assertContentReady() {
  const missing = missingContentFiles();
  if (!missing.length) return;

  const hint = configuredContentDir
    ? 'Restaura el respaldo en CONTENT_DIR antes de iniciar.'
    : 'Ejecuta "npm run content:init" para crear soloofertas/storage desde el snapshot.';
  throw new Error(`Contenido no inicializado. Faltan: ${missing.join(', ')}. ${hint}`);
}

module.exports = {
  APP_ROOT,
  CONTENT_DIR,
  PAGES_DIR,
  STORAGE_DIR,
  REGIONS,
  REQUIRED_DATA_FILES,
  dataPath,
  uploadsPath,
  missingContentFiles,
  assertContentReady,
};
