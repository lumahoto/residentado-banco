# Residentado v0.6.18 - imágenes por pregunta

## Hallazgo de auditoría

En el corpus oficial 2015-2025 se identificó una sola pregunta que depende de una imagen no descrita completamente en el texto:

- `RM-2022-A-038`: electrocardiograma adjunto.

La auditoría combinó:

1. búsqueda de expresiones como `adjunto`, `ver EKG`, `imagen siguiente` y equivalentes en las 2.180 preguntas;
2. inventario de imágenes embebidas del PDF unificado;
3. verificación visual de la página 187 del PDF unificado, correspondiente a la página 5 de la Prueba A 2022.

Las demás preguntas que mencionan radiografía, tomografía o electrocardiograma incluyen el hallazgo relevante dentro del enunciado y no requieren reproducir una imagen para poder resolverse.

## Cambios incluidos

- soporte opcional de imágenes en práctica, simulacro, simulacro histórico y revisión;
- imagen `assets/questions/RM-2022-A-038.jpg` extraída directamente del PDF fuente;
- migración de Supabase con campos de imagen y actualización de la pregunta;
- precarga de la imagen en el service worker;
- manifiesto de trazabilidad `QUESTION_IMAGES_MANIFEST_V0618.csv`.

## Instalación

1. Reemplazar los archivos de la app por esta versión o aplicar el diff de `app.js`, `styles.css` y `service-worker.js`.
2. Mantener la carpeta `assets/questions` en la raíz del despliegue.
3. Ejecutar `supabase_migration_v0_6_18_question_images.sql` en Supabase.
4. Recargar la aplicación. Si está instalada como PWA, cerrarla y abrirla nuevamente para activar el nuevo caché.

## Campos añadidos a `public.questions`

- `image_required`
- `image_url`
- `image_alt`
- `image_caption`
- `image_source_page`
- `image_source_bbox`

La app usa `select('*')`, por lo que no requiere cambios adicionales en las consultas.
