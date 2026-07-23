# Contenido editable

Las imagenes y los JSON administrados se guardan fuera del codigo en `CONTENT_DIR`.
El directorio `soloofertas/pages/` es un snapshot versionado de solo lectura y nunca se usa como destino de cambios del administrador.

## Desarrollo local

Sin `CONTENT_DIR`, la aplicacion usa `soloofertas/storage/`, que esta ignorado por Git.
Inicializa ese directorio una sola vez desde el snapshot:

```powershell
npm run content:init
```

La inicializacion copia solamente archivos faltantes y no sobrescribe contenido existente.

## Produccion

1. Configura `NODE_ENV=production`.
2. Configura `CONTENT_DIR` con una ruta persistente. La aplicacion no inicia en produccion si falta esta variable.
3. Restaura ahi las carpetas `gdl/data`, `gdl/uploads`, `mty/data` y `mty/uploads` del respaldo actual, o ejecuta `npm run content:init` con `CONTENT_DIR` configurado para sembrar un volumen vacio.
4. Verifica que el proceso tenga permisos de lectura, escritura y renombrado dentro de `CONTENT_DIR`.
5. Usa una sola instancia de la aplicacion: el almacenamiento basado en archivos no coordina escrituras entre varias replicas.

Al iniciar, el servidor comprueba que existan los JSON requeridos y falla con un mensaje explicito si el contenido no esta listo.

## Recuperacion

Cada cambio de JSON se publica mediante un archivo temporal y un renombrado atomico. Antes de sustituirlo se conserva la version anterior en:

```text
CONTENT_DIR/.backups/json/
```

Se retienen las ultimas 20 versiones de cada JSON. Las imagenes eliminadas o reemplazadas se mueven a:

```text
CONTENT_DIR/.backups/files/
```

Se retienen los ultimos 200 archivos por carpeta de contenido. Estas carpetas no se exponen como rutas publicas. Conviene incluir todo `CONTENT_DIR`, incluida `.backups`, en el respaldo externo del volumen.
