# Solo Ofertas image worker

Entrega variantes fijas de originales guardados en el bucket independiente `soloofertas-media-prod`.

Configuracion desplegada:

1. Bucket: `soloofertas-media-prod`.
2. Origen: `https://pub-b0e51119f5c14d939ed8e6fa5fb4ed36.r2.dev`.
3. CORS: `cors.json`.
4. Worker: `https://soloofertas-images.deanva08.workers.dev`.

Para actualizar: ejecuta `npx wrangler r2 bucket cors set soloofertas-media-prod --file cors.json --force` y `npx wrangler deploy` desde esta carpeta.

Las credenciales S3 pertenecen solo al servidor y deben limitarse a este bucket. Nunca se entregan al navegador.
