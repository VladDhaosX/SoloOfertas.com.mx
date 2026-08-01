# Contenido editable

Los JSON administrados se guardan fuera del codigo en `CONTENT_DIR`; en produccion las imagenes se guardan en Cloudflare R2.
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
2. Configura `CONTENT_DIR` con una ruta persistente. Si falta, el proceso conserva `/health` para diagnostico pero `/health/ready` responde 503 y las escrituras quedan bloqueadas.
3. Restaura ahi las carpetas `gdl/data` y `mty/data` del respaldo actual. Cada imagen debe tener una referencia R2 valida en el JSON.
4. Verifica que el proceso tenga permisos de lectura, escritura y renombrado dentro de `CONTENT_DIR`.
5. Usa una sola instancia de la aplicacion: el almacenamiento basado en archivos no coordina escrituras entre varias replicas.

Al iniciar, el servidor comprueba que existan los JSON requeridos y falla con un mensaje explicito si el contenido no esta listo.

## Recuperacion

Cada cambio de JSON se publica mediante un archivo temporal y un renombrado atomico. Antes de sustituirlo se conserva la version anterior en:

```text
CONTENT_DIR/.backups/json/
```

Se retienen las ultimas 20 versiones de cada JSON. Las imagenes viven en el bucket `soloofertas-media-prod`; no se copian a `CONTENT_DIR`. Conviene incluir `CONTENT_DIR/.backups` en el respaldo externo del volumen y configurar por separado el respaldo o versionado del bucket R2.

El administrador tambien puede descargar un ZIP de las carpetas regionales y restaurarlo. La restauracion se extrae y valida fuera de `CONTENT_DIR`; solamente despues se intercambian `gdl` y `mty`. La version anterior se conserva en:

```text
CONTENT_DIR/.backups/restores/
```

Se retienen los tres snapshots de restauracion mas recientes. El ZIP contiene solo JSON; valida referencias R2 pero no incluye ni restaura los objetos del bucket.
