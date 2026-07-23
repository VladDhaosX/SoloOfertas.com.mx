const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const APP_ROOT = path.join(__dirname, '..');
const checkConfiguration = "require('./content-paths').assertContentConfigured()";

function runCheck(contentDir) {
  return spawnSync(process.execPath, ['-e', checkConfiguration], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      CONTENT_DIR: contentDir,
    },
    encoding: 'utf8',
  });
}

const siblingContentDir = path.join(path.dirname(APP_ROOT), 'soloofertas-content-test');
const siblingResult = runCheck(siblingContentDir);
assert.equal(siblingResult.status, 0, siblingResult.stderr);

const deployedRootResult = runCheck(path.join(APP_ROOT, 'storage'));
assert.notEqual(deployedRootResult.status, 0);
assert(deployedRootResult.stderr.includes('fuera de la raiz desplegada'));

console.log('Content paths: volumen hermano permitido y raiz desplegada bloqueada OK');
