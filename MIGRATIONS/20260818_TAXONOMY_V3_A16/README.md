# Migración Taxonomía V3 — A16 freeze

**Batch:** `TAXV3-A16-20260818`  
**Release frontend compatible:** `REL-20260818-V1.4.0-TAXV3-A16`  
**Dataset revision objetivo:** `QUESTIONS-TAXV3-A16-20260818-R1`  
**Taxonomía:** `TAXONOMIA_RENTABILIDAD_TAX_AUD_FINAL_V3_2026-08-18`  
**Fuente:** `TAXONOMIA_META_AUDITORIA_FREEZE_A16_META-AUD-014` (`SHA-256 a759bd56e7a7170989e54f2d31baacc483274abcc4a8e5a0c25a4e2608e1ee7a`)

## Orden obligatorio

1. Cerrar la WebApp en todos tus dispositivos/pestañas.
2. Ejecutar `01_PRECHECK_READONLY.sql` y guardar el resultado.
3. Ejecutar `02_PREPARE_SCHEMA_AND_STAGE.sql`.
4. Ejecutar `03_LOAD_STAGE_TOPICS_ALIASES_RELATIONS.sql`.
5. Ejecutar `04_LOAD_STAGE_QUESTIONS.sql`.
6. Ejecutar `05_VALIDATE_STAGE_READONLY.sql`. No continuar si algún control no coincide.
7. Ejecutar `06_COMMIT_TAXONOMY_V3_A16.sql` **una sola vez**. El contenido canónico y el bump del manifiesto están en la misma transacción.
8. Ejecutar `07_POSTCHECK_READONLY.sql`.
9. Recién después abrir la WebApp v1.4.0 con conexión y hacer el smoke manual.
10. Si el postcheck falla, ejecutar `08_ROLLBACK_TAXONOMY_V3_A16.sql` antes de reabrir la app.

## Resultados esperados

- 2.180 preguntas activas, 2.180 IDs únicos.
- 287 topics activos y 303 filas almacenadas (287 activos + 16 deprecados preservados).
- suma `n_questions` de topics activos = 2.180.
- 0 `rentability_topic_id` huérfanos.
- 291 filas de alias/deprecación (289 `source_topic_id` únicos; dos IDs tienen además alias de label deliberados).
- 16 topics `DEPRECATED_DISTRIBUTED` preservados físicamente.
- 18 relaciones secundarias, todas con regla `QUESTION_COUNTS_ONLY_IN_PRIMARY_TOPIC`.
- `dataset_revision = QUESTIONS-TAXV3-A16-20260818-R1` y `metadata.active_topic_count = 287`.
- conteos de intentos/sesiones/flags/notas/memoria/perfil sin disminución; si mantuviste la app cerrada deben quedar idénticos.

## Seguridad

- Los backups se crean en `residentado_backup`, no en `public`, para no exponerlos por PostgREST ni crear políticas RLS de tablas históricas.
- El staging vive en `residentado_stage`.
- No se borra ningún topic histórico durante el commit.
- No cambia ningún ID de pregunta.
- No se escriben tablas de progreso de usuario.
- El manifiesto se actualiza al final de la misma transacción que questions/topics; por eso la app nunca debe considerar publicado un bundle parcialmente migrado.
- Los scores y tiers se importan exactamente desde A16; esta migración no recalcula `transferability_score` ni `structural_pattern_score`.

## Nota sobre TTS/Anki

No se migra `tts_topic_catalog` ni datos Anki en esta fase. La WebApp muestra TTS solo por coincidencia exacta de `rentability_topic_id`; los nuevos/deprecados quedan preparados para una migración posterior sin mapeos heurísticos por label.


## Semántica del rollback

El rollback restaura el contenido previo de `questions`, `rentability_topics`, aliases y relaciones, pero **no reutiliza** la revisión antigua del dataset. Publica `QUESTIONS-ROLLBACK-TAXV3-A16-20260818-R1`, con `rollback_of=QUESTIONS-TAXV3-A16-20260818-R1`, para que cualquier cliente que haya descargado V3 detecte también la reversión.
