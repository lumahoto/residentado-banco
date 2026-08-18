# Instrucciones exactas de aplicación — WebApp v1.4.0 + Supabase A16

## A. GitHub / WebApp primero

1. Conserva una copia del repositorio vigente actual.
2. Reemplaza/sube el contenido del paquete v1.4.0 a la rama que usas para publicar.
3. Verifica en los archivos publicados:
   - `version.js`: `1.4.0`;
   - cache: `residentado-v1-4-0`;
   - release: `REL-20260818-V1.4.0-TAXV3-A16`.
4. Antes de tocar Supabase, abre la WebApp contra el dataset V2 actual y confirma que inicia, muestra preguntas y permite crear/cerrar una sesión corta. v1.4.0 es compatible con V2.
5. Cierra todas las pestañas/dispositivos de la WebApp antes de migrar Supabase.

## B. Supabase

En el SQL Editor, ejecutar **uno por uno** los archivos de `MIGRATIONS/20260818_TAXONOMY_V3_A16/`:

1. `01_PRECHECK_READONLY.sql`
2. `02_PREPARE_SCHEMA_AND_STAGE.sql`
3. `03_LOAD_STAGE_TOPICS_ALIASES_RELATIONS.sql`
4. `04_LOAD_STAGE_QUESTIONS.sql`
5. `05_VALIDATE_STAGE_READONLY.sql`
6. `06_COMMIT_TAXONOMY_V3_A16.sql`
7. `07_POSTCHECK_READONLY.sql`

No ejecutar `06` si `05` no da exactamente 2.180 preguntas, 287 topics activos de staging, 291 aliases, 18 relaciones, suma de membresías 2.180 y 0 huérfanos.

`06` debe ejecutarse completo como una unidad. No copiar solo fragmentos internos del commit.

## C. Primera apertura post-migración

1. Abre v1.4.0 con conexión.
2. La app leerá `app_dataset_versions`.
3. Al detectar `QUESTIONS-TAXV3-A16-20260818-R1`, la caché V2 deja de considerarse válida.
4. Descarga questions + rentability_topics, valida el bundle y solo entonces reemplaza el corpus local.
5. Sesiones, intentos, notas, flags y memoria permanecen en sus stores/tablas independientes.
6. Ejecuta `docs/PRUEBAS_MANUALES_POST_DESPLIEGUE_V1_4_0.md`.

## D. Rollback

Si el postcheck o smoke falla antes de continuar estudiando:

1. Cierra la WebApp.
2. Ejecuta `08_ROLLBACK_TAXONOMY_V3_A16.sql` completo.
3. Reejecuta `01_PRECHECK_READONLY.sql` o controles equivalentes.
4. Abre v1.4.0 online. El rollback restaura el bundle anterior pero publica la revisión nueva `QUESTIONS-ROLLBACK-TAXV3-A16-20260818-R1`; la app la detectará y volverá a cargar automáticamente el bundle restaurado.

El rollback no toca tablas de progreso; restaura questions, topics y aliases/relaciones desde `residentado_backup`. También recupera los metadatos previos del manifiesto, pero sustituye únicamente su `dataset_revision` por una revisión nueva de rollback para garantizar invalidación en clientes.
