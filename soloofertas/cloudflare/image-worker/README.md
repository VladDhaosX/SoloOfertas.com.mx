# Solo Ofertas image worker

Entrega variantes fijas de originales guardados en el bucket independiente `soloofertas-media-prod`.

Configuracion desplegada:

1. Bucket: `soloofertas-media-prod`.
2. Binding R2 privado: `MEDIA_BUCKET`.
3. Binding de transformaciones: `IMAGES`.
4. Cache del Worker habilitada con respuestas inmutables por un ano.
5. CORS para cargas administrativas firmadas: `cors.json`.
6. Worker: `https://soloofertas-images.deanva08.workers.dev`.

Para actualizar: ejecuta `npx wrangler r2 bucket cors set soloofertas-media-prod --file cors.json --force` y `npx wrangler deploy` desde esta carpeta.

El bucket no necesita acceso publico `r2.dev`: el Worker obtiene los originales mediante el binding R2 y los transforma desde bytes con el binding Images. Las credenciales S3 pertenecen solo al servidor, deben limitarse a este bucket y nunca se entregan al navegador.
