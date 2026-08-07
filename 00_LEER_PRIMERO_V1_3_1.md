# Residentado v1.3.1 — exportación autosuficiente para auditoría y parche

**Fecha:** 6 de agosto de 2026  
**Base:** Residentado v1.3.0 del ZIP `260806_v130_residentado-banco-main(1).zip`  
**SHA-256 de la base recibida:** `2ef803ee51e256aaa72c0632d540d030500373e82e79def7a7c4d63299a33bc9`

## Cambio funcional

En **Preguntas para revisar → Pendientes**, la interfaz muestra un único botón:

`Exportar CSV completo para auditoría y parche`

Al pulsarlo, la aplicación:

1. toma los flags visibles según el filtro activo;
2. consulta directamente a Supabase las filas completas actuales de `public.question_review_flags`;
3. consulta directamente a Supabase las filas completas actuales de `public.questions`;
4. valida que no falte ningún flag ni ninguna pregunta;
5. genera un único CSV con todas las columnas detectadas dinámicamente;
6. prefija las columnas con `flag__` y `question__`;
7. incorpora metadatos `export__*`, incluyendo versión, lote, fuente, conteos, revisión, hash y fecha;
8. declara `export__source = SUPABASE_AUTHORITATIVE`.

No existe fallback silencioso a caché local. Si no hay conexión autenticada o la respuesta es incompleta, la aplicación no descarga el archivo.

## Publicación

1. Respaldar el despliegue v1.3.0.
2. Publicar todos los archivos de esta entrega.
3. No ejecutar migraciones nuevas: v1.3.1 no requiere cambios en Supabase.
4. Recargar dos veces; si es PWA, cerrarla y abrirla nuevamente.
5. Confirmar visualmente `v1.3.1`.
6. Marcar una pregunta de prueba y exportar el CSV.
7. Verificar que el nombre empiece por `residentado_revision_para_patch_`.
8. Abrir el CSV y confirmar columnas `export__source`, `flag__id`, `question__id`, `question__record_version` y `question__content_sha256`.
9. Confirmar que `export__source` sea `SUPABASE_AUTHORITATIVE` y `export__is_complete` sea `SI`.

## Archivos necesarios para que la WebApp funcione

Estos archivos o carpetas sí forman parte del runtime publicado:

- `index.html`
- `version.js`
- `styles.css`
- `app.js`
- `session-core.js`
- `session-storage.js`
- `question-parser.js`
- `w3-tools.js`
- `w4-data.js`
- `config.js`
- `pilot-data.js`
- `tts_catalog.json`
- `service-worker.js`
- `manifest.webmanifest`
- `icons/`
- `assets/questions/`

## Archivos que no ejecuta la WebApp

Los siguientes tipos no son cargados por `index.html` ni por el service worker y no afectan la ejecución ordinaria:

- documentos `.md`;
- manifiestos y checksums históricos;
- archivos `.diff`;
- `QA/`;
- `MIGRATIONS/` y SQL históricos;
- CSV/XLSX piloto;
- scripts de esquema, seed y setup de Supabase.

Sin embargo, varios conservan decisiones, pruebas, migraciones, rollback conceptual y trazabilidad. Por ello **v1.3.1 no elimina ni mueve archivos históricos**. La limpieza del repositorio debe hacerse como una tarea separada, preferentemente moviendo documentación antigua a `docs/archive/` o conservándola en GitHub Releases, con un índice que mantenga los enlaces y la secuencia de versiones.

## Guardrails preservados

- PT409/HTTP 409 para conflictos de sesión;
- recuperación no destructiva;
- lease entre pestañas;
- `CREATE_SESSION` mediante inserción;
- Mi Estado calculado localmente;
- catálogo TTS leído una vez y conservado en memoria;
- separación entre flags y notas personales;
- `session-core.js` y `session-storage.js` preservados byte por byte.
