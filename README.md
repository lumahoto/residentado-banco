# Residentado v1.4.0 — Taxonomía V3 A16

WebApp estática del banco de Residentado Médico Perú. Esta versión parte **exclusivamente** del ZIP v1.3.4 descargado del repositorio vigente el 17/08/2026 y añade compatibilidad segura con el freeze taxonómico A16 del 18/08/2026.

## Estado

- Frontend: `v1.4.0` / caché `residentado-v1-4-0`.
- Preguntas: 2.180 IDs estables.
- Taxonomía objetivo: V3 A16, 287 topics activos.
- Migración Supabase: preparada, **no aplicada**.
- Anki/TTS: **no migrados** en esta fase.
- `session-core.js` y `session-storage.js`: preservados byte por byte respecto del baseline v1.3.4.

## Cambio arquitectónico principal

La app ya no trata la taxonomía como un listado derivado solo de labels de preguntas. Carga `questions` + `rentability_topics`, compara `dataset_revision`, `taxonomy_version` y número de topics activos, valida el bundle completo y solo entonces reemplaza el corpus local en IndexedDB. Un bundle remoto parcial o incompatible no reemplaza una caché válida.

La identidad de topic del selector se serializa como `rentability_topic_id`. Las rutas antiguas basadas en labels conservan un resolver V2→V3 mediante `taxonomy_topic_aliases`.

## Migración Supabase

Seguir exactamente:

`MIGRATIONS/20260818_TAXONOMY_V3_A16/README.md`

El orden es: precheck → preparación/staging → carga → validación → commit transaccional → postcheck. El bump del manifiesto ocurre al final del mismo `COMMIT` que publica topics/questions/aliases, evitando estados mixtos V2/V3. Se incluye rollback.

## QA

```bash
python3 QA/qa_static.py
python3 QA/qa_browser.py
node QA/test_session_core.js
```

Los checks cubren, entre otros: versión/caché, PT409, sesiones no modificadas, identidad estable de topics, invalidación automática de corpus, ausencia de `274` en runtime, cobertura dinámica, filtros por tier y presencia/orden de la migración V3.

## Estructura

- raíz: runtime y metadatos actuales;
- `MIGRATIONS/`: migraciones inmutables, incluida Taxonomía V3 A16;
- `QA/`: QA vigente;
- `docs/`: documentación técnica vigente y expectativas A16;
- `DATABASE/`: esquema de referencia;
- historial cerrado: Git tags/releases y documento consolidado, no copias redundantes por versión.

## Publicación recomendada

1. Subir primero este repositorio v1.4.0 a GitHub y verificar que funciona todavía contra el dataset V2 actual.
2. Mantener la WebApp cerrada durante la migración de Supabase.
3. Aplicar los SQL V3 en el orden documentado y verificar el postcheck.
4. Abrir v1.4.0 con conexión: debe detectar automáticamente la nueva `dataset_revision`, descargar el bundle V3 y conservar sesiones/intentos/notas/flags.

No ejecutar migraciones antiguas por rutina.


### Rollback taxonómico V3 A16

El rollback incluido restaura el contenido previo sin borrar progreso y publica una revisión nueva (`QUESTIONS-ROLLBACK-TAXV3-A16-20260818-R1`) para forzar la invalidación segura del bundle V3 en clientes que ya lo hubieran descargado.
