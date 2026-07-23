const fs = require('fs');
const path = require('path');
const {
  CONTENT_DIR,
  PAGES_DIR,
  REGIONS,
  missingContentFiles,
} = require('../content-paths');

function copyDirectoryIfPresent(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: false,
  });
}

fs.mkdirSync(CONTENT_DIR, { recursive: true });

for (const region of REGIONS) {
  copyDirectoryIfPresent(
    path.join(PAGES_DIR, region, 'data'),
    path.join(CONTENT_DIR, region, 'data')
  );
  copyDirectoryIfPresent(
    path.join(PAGES_DIR, region, 'uploads'),
    path.join(CONTENT_DIR, region, 'uploads')
  );
}

const missing = missingContentFiles();
if (missing.length) {
  console.error(`No se pudo inicializar el contenido. Faltan: ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`Contenido inicializado en: ${CONTENT_DIR}`);
  console.log('Los archivos existentes no fueron sobrescritos.');
}
