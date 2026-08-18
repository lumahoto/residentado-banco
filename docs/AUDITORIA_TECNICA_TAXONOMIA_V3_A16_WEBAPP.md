# Auditoría técnica — WebApp + Taxonomía V3 A16

**Fecha:** 18/08/2026  
**Baseline de código:** `260817_residentado-banco-main_v134.zip` — SHA-256 `30ed0a4f148cefca3f33f80a89bed1c73960f10cd2b65270b53738771ebefda7`  
**Autoridad taxonómica:** `TAXONOMIA_META_AUDITORIA_FREEZE_A16_META-AUD-014` — SHA-256 `a759bd56e7a7170989e54f2d31baacc483274abcc4a8e5a0c25a4e2608e1ee7a`

## 1. Checkpoint A16 validado

Se verificó el manifiesto interno de A16 contra hashes y tamaños: 87 entradas, 0 discrepancias.

A16 fija:

- 2.180 preguntas y 2.180 membresías primarias;
- 287 topics activos;
- 29 topics activos V3 nuevos;
- 258 IDs V2 retenidos como activos;
- 16 IDs V2 deprecados/distribuidos, que deben conservarse físicamente;
- 291 filas de alias/deprecación, correspondientes a 289 `source_topic_id` únicos;
- 18 relaciones secundarias cross-topic que no duplican cobertura;
- 162 topics con confianza de tier `HIGH` y 125 `BORDERLINE`;
- freeze hasta el examen, salvo error taxonómico inequívoco o requisito normativo material nuevo.

Cortes de rentabilidad preservados desde A16: MUY_ALTA ≥75; ALTA 60–<75; MEDIA 40–<60; BAJA <40. `BORDERLINE` se conserva como trazabilidad y no genera un quinto tier.

## 2. Delta estructural respecto del snapshot V2 disponible

El snapshot previo contiene 274 topics. La reconciliación A16 produce 303 filas almacenadas después de migrar: 287 activas + 16 deprecadas preservadas.

En las 2.180 preguntas, A16 cambia, entre otros:

- `canonical_area`: 51 preguntas;
- `canonical_specialty`: 139;
- `rentability_topic_id`: 402;
- `rentability_topic_label`: 1.143;
- `exam_rentability_score`: 2.180;
- `rentability_tier`: 739.

Estos cambios son **esperados por la nueva taxonomía**, no bugs. Tampoco es bug que cambien porcentajes de cobertura por topic después de reasignar membresías.

## 3. Hallazgos del baseline v1.3.4

### 3.1. Consumo de datos

- `questions` se carga paginado desde Supabase y se guarda en IndexedDB.
- El baseline derivaba `topics` desde las preguntas; no consumía `rentability_topics` como catálogo autoritativo de runtime.
- `app_dataset_versions` ya gobernaba la invalidación del corpus por `dataset_revision`, pero solo validaba esencialmente revisión + conteo de preguntas.

### 3.2. Sesiones y progreso

- Las sesiones persistentes guardan IDs estables de preguntas (`question_ids`), no una copia de la taxonomía.
- `session-core.js` y `session-storage.js` contienen los guardrails PT409, revisión optimista y recuperación no destructiva.
- `replaceCorpus()` reemplaza preguntas/topics/metadatos del corpus sin borrar intentos, sesiones, notas, flags ni memoria.
- Por esto, conservar los 2.180 IDs de pregunta hace viable la migración sin reconstruir historial.

### 3.3. Dependencias de labels

El selector de topics del baseline serializaba una ruta `Área + Especialidad + label del topic`. Con renombres/deprecaciones V3, esa identidad podía romper filtros guardados o lógica futura. Se corrigió para usar `rentability_topic_id` y se añadió compatibilidad con paths V2 y aliases.

### 3.4. Mi Estado

El baseline v1.3.4 había cambiado el denominador principal de cobertura a preguntas no observadas. Para la migración taxonómica esto impedía comprobar que las 2.180 preguntas pertenecen exactamente una vez al catálogo. v1.4.0 separa:

- cobertura taxonómica: las 2.180 preguntas;
- métricas adaptativas de precisión/debilidad: continúan excluyendo observadas cuando corresponde.

### 3.5. Constante 274

No queda `274` hardcodeado en runtime. Las referencias restantes a 274 están exclusivamente en el respaldo TTS V061 y documentación histórica; se preservan porque TTS todavía no se migra en esta fase.

### 3.6. Bug de trazabilidad preexistente

El ZIP suministrado declaraba `v1.3.4` en `version.js`, pero `RELEASE_MANIFEST.json` y `QA/qa_static.py` seguían dirigidos a `v1.3.1`. Esto es un bug de trazabilidad/QA del baseline y se corrige en v1.4.0.

## 4. Cambios implementados en v1.4.0

1. Carga de `questions` + `rentability_topics` como bundle coherente.
2. Validación de:
   - IDs de preguntas únicos;
   - `row_count` de preguntas;
   - número de topics activos;
   - IDs de topic activos únicos;
   - cero preguntas huérfanas;
   - `n_questions` por topic consistente;
   - `taxonomy_version` consistente cuando el manifiesto lo declara.
3. La caché antigua se invalida automáticamente por `dataset_revision`; también se compara `active_topic_count` y `taxonomy_version`.
4. Un bundle remoto incompatible se rechaza y no reemplaza una caché válida.
5. `rentability_topic_id` pasa a ser la identidad persistente del selector de topics.
6. Resolver compatible de aliases/deprecaciones para IDs o labels históricos.
7. Filtros individuales MUY_ALTA, ALTA, MEDIA y BAJA, además del filtro MUY_ALTA+ALTA.
8. Mi Estado usa 2.180 preguntas para cobertura y número dinámico de topics activos.
9. La especialidad se usa como columna vertebral de navegación; su score agregado se etiqueta solo como promedio descriptivo, no como tier canónico inventado.
10. `tier_confidence=BORDERLINE`, `sample_band` y `scoring_reliability_policy` quedan disponibles para UI/trazabilidad.
11. TTS se mantiene por coincidencia exacta de ID; no se hace mapeo heurístico por label.
12. `session-core.js` y `session-storage.js` permanecen byte por byte iguales al baseline v1.3.4.

## 5. Estrategia Supabase

La migración se separa en preparación/staging y un único commit de publicación:

`staging → validar → backup fuera de public → topics activos/nuevos → deprecados → questions → aliases/relaciones → controles de integridad → bump app_dataset_versions → COMMIT`

El bump del manifiesto es el último cambio lógico dentro de la misma transacción. Si cualquier control falla, PostgreSQL revierte todas las modificaciones del commit.

Los backups viven en `residentado_backup`, no en `public`, para no exponer copias históricas por PostgREST ni reabrir el problema de RLS sobre tablas backup públicas.

## 6. No modificado en esta fase

- contenido Anki;
- programación/GUID/FSRS Anki;
- corpus o catálogo TTS;
- `tts_topic_catalog`;
- intentos;
- sesiones;
- flags;
- notas personales;
- memoria adaptativa;
- perfil del usuario.

La compatibilidad necesaria para Anki/TTS queda preparada mediante IDs estables, aliases y relaciones secundarias.
