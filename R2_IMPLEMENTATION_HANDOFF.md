# Handoff: migracion de imagenes de Solo Ofertas a Cloudflare R2

Fecha: 2026-07-31

## Resumen

Se implemento la salida de las imagenes y sus transformaciones fuera de Hostinger.
El nuevo flujo carga los originales directamente desde el navegador a Cloudflare
R2, entrega variantes mediante un Worker exclusivo de Solo Ofertas y conserva en
Hostinger solamente los JSON de contenido y la API de administracion.

La aplicacion y el Worker estan implementados y probados. Los recursos de
Cloudflare ya existen. Todavia no se han migrado las imagenes ni se ha desplegado
esta version de la aplicacion en Hostinger porque falta crear una credencial S3
restringida al bucket de Solo Ofertas.

No hay secretos en este documento ni en los archivos versionados.

## Motivo del cambio

El flujo anterior guardaba originales en el volumen local y usaba Sharp dentro
del proceso Node.js para crear variantes. Eso aumentaba memoria, hilos nativos,
procesos y trabajo servido por Hostinger.

Objetivos:

- no almacenar imagenes nuevas en Hostinger;
- no transformar imagenes en la API local;
- subir los bytes directamente del navegador a R2;
- usar recursos de Cloudflare separados de SoloEmpleos;
- mantener validacion, autenticacion y publicaciones atomicas;
- dejar una ruta de migracion segura para el contenido existente.

## Arquitectura implementada

```text
Administrador
  -> API Hostinger: solicita URL PUT firmada
  -> R2: sube el archivo directamente
  -> API Hostinger: publica solamente la clave R2
  -> JSON persistente: guarda URL y descriptor de medios

Visitante
  -> portal Solo Ofertas
  -> URL del Worker con preset cerrado
  -> Worker obtiene el original de R2
  -> Cloudflare transforma y entrega la variante cacheada
```

Hostinger ya no recibe el cuerpo de las imagenes en el flujo R2. Solo firma la
operacion, comprueba que el objeto exista, valida que el Worker pueda procesarlo
y actualiza los JSON.

## Recursos creados en Cloudflare

| Recurso | Valor |
|---|---|
| Cuenta | `8736da5067a8e8d28b53a083f09c9002` |
| Bucket | `soloofertas-media-prod` |
| Region R2 | `WNAM` |
| Acceso del Worker | Binding R2 privado `MEDIA_BUCKET` |
| Transformaciones | Binding Images `IMAGES` |
| Worker | `soloofertas-images` |
| URL del Worker | `https://soloofertas-images.deanva08.workers.dev` |
| Version desplegada | `baa22606-0a3d-4101-a18d-aa86117cff3e` |

Estado comprobado al cierre de esta sesion:

- bucket creado y enlazado de forma privada al Worker;
- CORS aplicado y leido de nuevo mediante Wrangler;
- Worker desplegado correctamente;
- Worker real responde HTTP 404 JSON para una clave inexistente;
- 35 objetos y 136 variantes comprobados mediante el Worker;
- acceso publico `r2.dev` deshabilitado despues de validar el Worker;
- origen publico comprobado con HTTP 401 y produccion con readiness HTTP 200;
- Wrangler autenticado mediante OAuth.

El CORS permite solamente:

- origen: `https://soloofertas.com`;
- metodo: `PUT`;
- headers: `Content-Type` y `Cache-Control`;
- header expuesto: `ETag`;
- cache preflight: 3600 segundos.

La configuracion reproducible esta en:

- `soloofertas/cloudflare/image-worker/wrangler.jsonc`;
- `soloofertas/cloudflare/image-worker/cors.json`;
- `soloofertas/cloudflare/image-worker/src/index.mjs`;
- `soloofertas/cloudflare/image-worker/README.md`.

## Flujo de carga

1. El administrador envia tipo, MIME y tamano a
   `POST /soloofertas/:region/media/uploads`.
2. La API valida la solicitud y devuelve una URL PUT firmada por 300 segundos.
3. El navegador hace PUT directamente al endpoint S3 de R2 con el archivo.
4. El navegador envia solamente la clave recibida a la ruta de portada,
   ofertas o cupones.
5. La API hace HEAD firmado al objeto R2 y valida tamano, MIME y extension.
6. La API hace HEAD a una variante del Worker para confirmar que Cloudflare
   reconoce el objeto como imagen.
7. El JSON se publica mediante escritura atomica.
8. Solo despues de publicar el JSON se elimina de R2 el objeto reemplazado.

Si falla la publicacion, la API intenta eliminar el objeto nuevo. El token S3
nunca se entrega al navegador; este recibe solamente una firma temporal para
una clave concreta.

## Formato guardado en los JSON

Ejemplo simplificado:

```json
{
  "id": "uuid",
  "url": "https://soloofertas-images.deanva08.workers.dev/full/gdl/vacantes/uuid.jpg",
  "fecha": "2026-07-31",
  "rotation": 0,
  "telefono": "",
  "media": {
    "provider": "r2",
    "key": "gdl/vacantes/uuid.jpg",
    "urls": {
      "small": "https://soloofertas-images.deanva08.workers.dev/small/gdl/vacantes/uuid.jpg",
      "thumb": "https://soloofertas-images.deanva08.workers.dev/thumb/gdl/vacantes/uuid.jpg",
      "full": "https://soloofertas-images.deanva08.workers.dev/full/gdl/vacantes/uuid.jpg",
      "admin": "https://soloofertas-images.deanva08.workers.dev/admin/gdl/vacantes/uuid.jpg"
    },
    "mime": "image/jpeg",
    "size": 123456
  }
}
```

Se conserva `url` por compatibilidad con el render existente. `media.key` es la
identidad del objeto y `media.urls` contiene las variantes permitidas.

## Presets del Worker

| Tipo | Presets disponibles |
|---|---|
| Ofertas (`vacantes`) | `small`, `thumb`, `full`, `admin` |
| Portadas (`portadas`) | `cover`, `hero` |
| Cupones (`cupones`) | `thumb`, `full`, `admin` |

Las rutas del Worker validan preset, region, tipo y nombre. Cupones solo permite
la region GDL. No acepta parametros libres de ancho, calidad o formato.

## Cambios principales en la aplicacion

### Almacenamiento R2

`soloofertas/services/r2-storage.js`:

- usa `aws4fetch` para firmar operaciones S3;
- genera nombres UUID;
- permite JPEG, PNG y WebP;
- limita cada archivo a 10 MB;
- genera URLs PUT con expiracion de cinco minutos;
- verifica objetos con HEAD;
- verifica transformacion mediante el Worker;
- elimina objetos y genera descriptores publicos.

### API de cargas

`soloofertas/routes/uploads.js` agrega:

- `POST /media/uploads`: crea la firma temporal;
- `DELETE /media/uploads`: limpia una o varias claves nuevas.

Ambas rutas requieren el JWT de administrador. La limpieza limita region,
estructura de clave y un maximo de 200 objetos.

### Portadas, ofertas y cupones

Se actualizaron:

- `soloofertas/routes/portada.js`;
- `soloofertas/routes/vacantes.js`;
- `soloofertas/routes/cupones.js`.

Ya no reciben multipart ni bytes de imagen. Reciben `{ "key": "..." }` o
`{ "keys": ["..."] }`, verifican R2, escriben JSON y limpian objetos
reemplazados despues de la escritura.

Se conservaron rotacion, telefono, ordenamiento, reemplazo total y borrado.

### Administrador

`soloofertas/pages/admin/js/admin.js` ahora:

- solicita una firma a la API;
- hace PUT directo del `File` del navegador a R2;
- no envia el JWT al dominio de R2;
- publica la clave una vez terminada la carga;
- limpia claves conocidas cuando una operacion falla;
- muestra URLs remotas en las vistas previas;
- carga carpetas de forma secuencial para limitar picos.

Se actualizo el cache busting de `admin.js` a `20260731-r2`.

### Portal publico y SSR

Se actualizaron `soloofertas/server.js` y
`soloofertas/pages/shared/js/inicio.js` para:

- usar las variantes remotas de `media.urls`;
- construir `srcset` con `small` y `thumb`;
- usar `full` en modales y paginas de oferta;
- usar `cover` y `hero` para portadas;
- mantener URLs absolutas correctas en SEO y datos estructurados;
- evitar prefijos dobles como `https://soloofertas.comhttps://...`.

Con `MEDIA_STORAGE=r2`, las rutas locales `/uploads` quedan deshabilitadas.
La antigua API `/media` fue eliminada completamente.

### Eliminacion de Sharp

Se eliminaron:

- dependencia `sharp`;
- `soloofertas/routes/media.js`;
- `soloofertas/tests/media.test.js`;
- montaje de la ruta local de transformacion.

El modo temporal `MEDIA_STORAGE=local` sirve los originales sin transformarlos.
No ejecuta Sharp.

### Inicio de contenido

`soloofertas/scripts/init-content.js` no copia las carpetas `uploads` cuando
`MEDIA_STORAGE=r2`. Esto evita que un redeploy vuelva a introducir imagenes
locales.

### Respaldo y restauracion

`soloofertas/routes/backup.js` ahora respalda solamente:

- `gdl/data`;
- `mty/data`.

El ZIP valida que todas las referencias sean R2, que las claves pertenezcan a la
region y tipo correctos y que todas las variantes sean HTTPS.

Los objetos R2 no estan incluidos en el ZIP. El bucket necesita una politica de
respaldo o versionado separada. Se conservan los snapshots JSON de restauracion.

### Migracion del contenido existente

`soloofertas/scripts/migrate-media-to-r2.js`:

- lee portadas, ofertas y cupones locales;
- sube los originales secuencialmente a R2;
- verifica cada objeto mediante el Worker;
- prepara todos los documentos antes de publicar;
- usa escrituras JSON atomicas;
- restaura los JSON si una escritura falla;
- elimina los objetos nuevos si la migracion no se publica;
- acepta `--delete-local` para borrar uploads solo despues del exito.

La mayor imagen del snapshot revisado mide aproximadamente 2.36 MB, por debajo
del limite de 10 MB.

## Variables de entorno

Configuracion preparada en `soloofertas/.env.example`:

```dotenv
MEDIA_STORAGE=r2
R2_ACCOUNT_ID=8736da5067a8e8d28b53a083f09c9002
R2_BUCKET=soloofertas-media-prod
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_ENDPOINT=
MEDIA_DELIVERY_BASE_URL=https://soloofertas-images.deanva08.workers.dev
```

`R2_ENDPOINT` es opcional. Si esta vacio se usa:

```text
https://8736da5067a8e8d28b53a083f09c9002.r2.cloudflarestorage.com
```

El `.env` local existe, pero al cierre de la sesion no contiene ninguna de estas
variables R2. Los valores secretos tampoco estan configurados en este repositorio.

## Credencial S3 pendiente

Wrangler usa OAuth para crear buckets y desplegar Workers. Esa sesion no es una
credencial S3 y la aplicacion Node.js de Hostinger no puede reutilizarla.

Pendiente en Cloudflare:

1. Abrir R2 y seleccionar `Manage R2 API Tokens`.
2. Crear un token de lectura y escritura de objetos.
3. Limitarlo exclusivamente a `soloofertas-media-prod`.
4. Copiar Access Key ID y Secret Access Key.
5. Guardarlos en el `.env` local o en variables de Hostinger; no pegarlos en un
   issue, PR, commit ni conversacion.

Aunque un token general existente pudiera funcionar, no se debe reutilizar el de
SoloEmpleos porque el requisito es que ambos proyectos trabajen por separado.

## Diferencia con SoloEmpleos

SoloEmpleos si utiliza credenciales S3 en produccion:

- declara `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY`;
- crea un `AwsClient` de `aws4fetch`;
- usa el cliente firmado para PUT y DELETE;
- la pagina publica comprobada entrega URLs de
  `soloempleos-images.deanva08.workers.dev` y no URLs locales.

La diferencia esta en el recorrido de los bytes:

```text
SoloEmpleos:
navegador -> Hostinger/Multer/archivo temporal -> R2

Solo Ofertas:
navegador -> R2
Hostinger -> solamente firma y verifica
```

Los dos requieren autoridad para escribir en R2. En Solo Ofertas la credencial
solo firma la operacion y no transporta el archivo por Hostinger.

## Pruebas y validaciones realizadas

Comando principal:

```powershell
npm test
```

Resultado: suite completa aprobada.

Cobertura ejecutada:

- rutas y configuracion de `CONTENT_DIR`;
- escritura atomica, respaldos y validacion de JSON;
- operaciones de ofertas y cupones con objetos R2;
- creacion de firmas, verificacion, URLs y eliminacion R2;
- rutas de firma, publicacion, reemplazo y limpieza;
- presets, rutas cerradas y origen del Worker;
- SSR, SEO, cache y health checks;
- servidor en modo R2 con URLs remotas;
- confirmacion de HTTP 404 para `/media` y `/uploads` en modo R2.

Validaciones adicionales:

- firma real cargando `aws4fetch`: correcta;
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilidades;
- `git diff --check`: correcto;
- `node --check` sobre los archivos JavaScript modificados: correcto;
- CORS del bucket consultado despues de configurarlo: correcto;
- Worker y origen R2 consultados por HTTPS: correctos.

## Secuencia recomendada para terminar la migracion

1. Crear la credencial S3 restringida al bucket.
2. Respaldar los JSON y las imagenes locales actuales de produccion.
3. Configurar en el entorno que ejecutara la migracion:

   ```dotenv
   MEDIA_STORAGE=local
   R2_ACCOUNT_ID=8736da5067a8e8d28b53a083f09c9002
   R2_BUCKET=soloofertas-media-prod
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   MEDIA_DELIVERY_BASE_URL=https://soloofertas-images.deanva08.workers.dev
   ```

4. Asegurar que `CONTENT_DIR` apunta al volumen persistente real de produccion.
5. Ejecutar primero sin borrar los originales:

   ```powershell
   npm run media:migrate
   ```

6. Revisar que los JSON tengan `media.provider: "r2"` y abrir varias URLs del
   Worker.
7. Configurar `MEDIA_STORAGE=r2` en Hostinger y desplegar esta version.
8. Verificar `/health`, `/health/ready`, portada, ofertas, modal, administrador y
   una carga nueva.
9. Cuando la produccion este validada, eliminar los uploads locales ejecutando:

   ```powershell
   npm run media:migrate -- --delete-local
   ```

El script omite elementos que ya tienen `media.provider: "r2"`, por lo que el
segundo comando solamente valida documentos y limpia las carpetas locales.

## Rollback

Mientras no se use `--delete-local`, los originales permanecen disponibles.

Si falla antes de activar R2:

1. conservar `MEDIA_STORAGE=local`;
2. restaurar los JSON previos desde `CONTENT_DIR/.backups/json` si fuera
   necesario;
3. corregir la causa y repetir la migracion.

Si falla despues del despliegue R2:

1. no eliminar los objetos R2;
2. restaurar los JSON previos y volver temporalmente a `MEDIA_STORAGE=local`;
3. redesplegar;
4. investigar Worker, credenciales o referencias antes de reactivar R2.

El Worker no depende de `r2.dev`: lee originales con `MEDIA_BUCKET` y los
transforma desde bytes mediante `IMAGES`.

## Consideraciones para un portal publico estatico

La separacion de imagenes ya es compatible con el objetivo futuro:

```text
portal estatico -> JSON de contenido -> URLs del Worker -> R2
```

Lo que todavia depende de Hostinger no son las imagenes, sino el plano de control:

- autenticacion del administrador;
- firma y confirmacion de cargas;
- escritura de JSON;
- respaldos/restauracion;
- contacto SMTP;
- SSR y rutas dinamicas de oferta.

Para un portal completamente estatico se puede mover la API administrativa a un
Worker o Pages Function y guardar los metadatos en R2, KV o D1. El bucket y el
Worker de imagenes actuales pueden conservarse.

Tambien se podria reemplazar la firma S3 de Hostinger por un Worker con binding
R2. En ese caso Cloudflare recibiria la carga y Hostinger dejaria de necesitar
credenciales S3.

## Simplificaciones y limites conocidos

- Si la pestana se cierra despues del PUT y antes de publicar la clave, puede
  quedar un objeto huerfano. Los errores conocidos limpian claves; no existe aun
  una tarea periodica de reconciliacion.
- Los originales son privados. La lectura publica se limita a las variantes
  permitidas y validadas por el Worker.
- Se guardan `url`, `media.key` y todas las variantes. Es redundante, pero mantiene
  compatibilidad. Un portal futuro podria guardar solo la clave o URL canonica.
- Las cargas por carpeta son secuenciales. Agregar concurrencia limitada solo si
  el tiempo de carga resulta un problema medido.
- El ZIP del administrador respalda metadatos, no objetos R2.
- La cache del Worker depende de `Cache-Control`; al cambiar una imagen se genera
  una clave UUID nueva, por lo que las variantes previas no se reutilizan.

## Archivos relevantes

Nuevos:

- `soloofertas/services/r2-storage.js`;
- `soloofertas/routes/uploads.js`;
- `soloofertas/scripts/migrate-media-to-r2.js`;
- `soloofertas/cloudflare/image-worker/*`;
- `soloofertas/tests/r2-storage.test.js`;
- `soloofertas/tests/r2-routes.test.js`;
- `soloofertas/tests/r2-public-server.test.js`;
- `soloofertas/tests/cloudflare-worker.test.mjs`.

Modificados principalmente:

- `soloofertas/server.js`;
- `soloofertas/pages/admin/js/admin.js`;
- `soloofertas/pages/shared/js/inicio.js`;
- rutas de portada, ofertas, cupones y backup;
- configuracion de entorno y paquetes;
- documentacion de Hostinger y contenido.

Eliminados:

- `soloofertas/routes/media.js`;
- `soloofertas/tests/media.test.js`;
- dependencia `sharp`.

## Referencias de Cloudflare

- URLs firmadas R2: <https://developers.cloudflare.com/r2/api/s3/presigned-urls/>
- CORS R2: <https://developers.cloudflare.com/r2/buckets/cors/>
- Tokens R2: <https://developers.cloudflare.com/r2/api/tokens/>
- Transformaciones mediante Workers:
  <https://developers.cloudflare.com/images/optimization/transformations/transform-via-workers/>

## Checklist para retomar en otra sesion

- [x] Implementacion R2 directa en la aplicacion.
- [x] Worker independiente implementado.
- [x] Bucket independiente creado.
- [x] CORS configurado.
- [x] Worker desplegado y validado.
- [x] Sharp y transformacion local eliminados.
- [x] Migrador y pruebas agregados.
- [ ] Credencial S3 restringida creada.
- [ ] Variables R2 configuradas fuera del repositorio.
- [ ] Imagen de prueba cargada y transformada.
- [ ] Contenido persistente de produccion migrado.
- [ ] Aplicacion desplegada en Hostinger con `MEDIA_STORAGE=r2`.
- [ ] Verificacion funcional de produccion completada.
- [ ] Politica de respaldo/versionado de R2 definida.
