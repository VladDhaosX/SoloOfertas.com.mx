const fs = require('fs');
const path = require('path');

const APP_ROOT = __dirname;
const PAGES_DIR = path.join(APP_ROOT, 'pages');
const STORAGE_DIR = path.join(APP_ROOT, 'storage');
const REGIONS = ['gdl', 'mty'];
const localStorageReady = REGIONS.every(region =>
  fs.existsSync(path.join(STORAGE_DIR, region, 'data', 'vacantes.json'))
);
const CONTENT_DIR = process.env.CONTENT_DIR
  ? path.resolve(APP_ROOT, process.env.CONTENT_DIR)
  : localStorageReady ? STORAGE_DIR : PAGES_DIR;

function dataPath(region, filename) {
  return path.join(CONTENT_DIR, region, 'data', filename);
}

function uploadsPath(region, type, filename = '') {
  return path.join(CONTENT_DIR, region, 'uploads', type, filename);
}

module.exports = { APP_ROOT, CONTENT_DIR, PAGES_DIR, REGIONS, dataPath, uploadsPath };
