# Contenido editable

Las imágenes y los JSON administrados se guardan fuera del código en `CONTENT_DIR`.

Antes de desplegar:

1. Configurar `CONTENT_DIR` con una ruta persistente fuera del checkout.
2. Restaurar ahí las carpetas `gdl/data`, `gdl/uploads`, `mty/data` y `mty/uploads` del respaldo actual.
3. Verificar el contenido antes de publicar el nuevo código.

Sin `CONTENT_DIR`, el entorno local usa `soloofertas/storage/`, que está ignorado por Git.

El repositorio conserva en `soloofertas/pages/{gdl,mty}/{data,uploads}` un snapshot de las imágenes productivas. Este snapshot protege el contenido incluido en el despliegue, pero no sustituye el almacenamiento persistente para cambios posteriores hechos desde el administrador.
