# Publicacion en Hostinger

Este proyecto usa GitHub Actions para integracion continua y la integracion GitHub de Hostinger para despliegue continuo.

## Flujo

1. Crear una rama `feature/*`, `fix/*` o `chore/*`.
2. Abrir un Pull Request hacia `main`.
3. Esperar que el check `test` termine correctamente.
4. Fusionar el Pull Request.
5. Hostinger detecta el cambio en `main`, construye la aplicacion y la reinicia.
6. Verificar `https://soloofertas.com/health`, `https://soloofertas.com/health/ready` y la portada publica.

No se permiten pushes directos a `main`.

## Ajustes de la aplicacion Node.js

Configurar en hPanel, dentro de `Deployments > Settings and redeploy`:

```text
Framework: Express.js
Root directory: soloofertas
Node.js: 22.x
Package manager: npm
Build configuration: Default
Start command: npm start
Entry file: server.js
```

El preset Express de Hostinger no expone un comando de build personalizado. Durante la instalacion, `postinstall` ejecuta el inicializador idempotente de contenido. Copia el snapshot solamente cuando faltan archivos y nunca sobrescribe contenido administrado existente. `npm run build` permite ejecutar la misma comprobacion manualmente.

## Variables de entorno

```text
NODE_ENV=production
CONTENT_DIR=/ruta/persistente/fuera-del-directorio-nodejs
ADMIN_USER=...
ADMIN_PASSWORD=...
JWT_SECRET=...
SMTP_HOST=...
SMTP_PORT=...
SMTP_USER=...
SMTP_PASS=...
EMAIL_DESTINO=...
```

No guardar secretos en GitHub ni en archivos del repositorio.

## Persistencia

`CONTENT_DIR` debe apuntar a un directorio escribible que Hostinger no reemplace durante cada build. El directorio tiene que estar fuera de la raiz desplegada `soloofertas` y fuera de `public_html`; puede ser un directorio hermano administrado por la misma cuenta de hosting.

Antes del primer despliegue:

1. Crear el directorio persistente desde el administrador de archivos de Hostinger.
2. Confirmar permisos de lectura, escritura y renombrado para el proceso Node.js.
3. Configurar la ruta absoluta en `CONTENT_DIR`.
4. Ejecutar el despliegue. El build siembra el volumen desde el snapshot versionado.
5. Subir un archivo de prueba desde el administrador, redeplegar y confirmar que sigue disponible.

Mientras la aplicacion use JSON y archivos, mantener una sola instancia activa.

## Verificacion y rollback

El endpoint `/health` (tambien disponible en `/health/live`) comprueba solamente que el proceso Node.js esta vivo y siempre devuelve HTTP 200 mientras Express pueda responder. Incluye `instanceId`, `startedAt` y `uptimeSeconds` para distinguir reinicios reales de multiples workers.

El endpoint `/health/ready` valida el almacenamiento persistente. Devuelve HTTP 200 si todos los JSON requeridos existen y son validos, o HTTP 503 cuando el contenido no esta disponible. Los monitores que reinicien el proceso deben usar `/health`; las alertas de contenido deben consultar `/health/ready` sin reiniciar la aplicacion.

Los archivos MP4 bajo `/shared/img` permiten cache de una hora en el navegador y un dia en el CDN. Esto evita que cada visita vuelva a transferir hasta decenas de MB desde el proceso Node.js.

## Diagnostico de reinicios

Cada proceso escribe eventos JSON con `type: "lifecycle"` en los Runtime logs de Hostinger. Para confirmar un reinicio, comparar `instanceId`, `pid`, `event` y `timestamp`:

- `starting` y `listening`: inicio real de una instancia.
- `shutdown_started`: Hostinger o el sistema envio `SIGTERM`, `SIGINT` o `SIGHUP`.
- `uncaught_exception`, `unhandled_rejection` o `server_error`: terminacion causada por la aplicacion.
- `shutdown_timeout`: el servidor no pudo cerrar en diez segundos.
- `exit`: codigo final y memoria RSS/heap de la instancia.

Un `starting` con un `instanceId` nuevo y sin evento de salida de la instancia anterior suele indicar `SIGKILL`, OOM o reemplazo externo del contenedor. En ese caso hay que correlacionar la hora UTC con RAM, Max processes y Runtime logs en hPanel.

Si una publicacion falla:

1. Revisar el log del deployment en hPanel.
2. Revertir el merge defectuoso mediante un nuevo Pull Request.
3. Esperar CI y fusionar el revert.
4. Hostinger publicara de nuevo la ultima version estable sin modificar `CONTENT_DIR`.

Los respaldos de contenido se encuentran dentro de `CONTENT_DIR/.backups/` y deben incluirse en la politica externa de backups del hosting.
