const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloofertas-content-store-'));
process.env.CONTENT_DIR = tempDir;

const {
  BACKUPS_DIR,
  readJson,
  readJsonArray,
  writeJsonAtomic,
  archiveFile,
} = require('../content-store');

function run() {
  try {
    const jsonPath = path.join(tempDir, 'gdl', 'data', 'vacantes.json');
    const initial = [{ id: 'uno', url: '/gdl/uploads/vacantes/uno.jpg' }];
    const updated = [{ id: 'dos', url: '/gdl/uploads/vacantes/dos.jpg' }];

    writeJsonAtomic(jsonPath, initial);
    assert.deepEqual(readJsonArray(jsonPath), initial);
    const missingPath = path.join(tempDir, 'gdl', 'data', 'missing.json');
    assert.throws(() => readJsonArray(missingPath), err => err.code === 'ENOENT');
    assert.deepEqual(readJsonArray(missingPath, { missing: [] }), []);

    writeJsonAtomic(jsonPath, updated);
    assert.deepEqual(readJsonArray(jsonPath), updated);

    const jsonBackupDir = path.join(BACKUPS_DIR, 'json', 'gdl', 'data');
    const backups = fs.readdirSync(jsonBackupDir).filter(name => name.endsWith('.bak'));
    assert.equal(backups.length, 1);
    assert.deepEqual(readJson(path.join(jsonBackupDir, backups[0])), initial);

    fs.writeFileSync(jsonPath, '{invalido', 'utf8');
    assert.throws(() => readJsonArray(jsonPath), SyntaxError);

    const imagePath = path.join(tempDir, 'gdl', 'uploads', 'vacantes', 'uno.jpg');
    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    fs.writeFileSync(imagePath, 'imagen', 'utf8');
    const archivedPath = archiveFile(imagePath);
    assert.equal(fs.existsSync(imagePath), false);
    assert.equal(fs.readFileSync(archivedPath, 'utf8'), 'imagen');

    console.log('Content store: escritura atomica, respaldo, validacion y archivado OK');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run();
