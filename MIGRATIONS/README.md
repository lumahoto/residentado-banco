# Migraciones de Supabase

## Estado actual

La Taxonomía V3 A16 del 18/08/2026 **ya fue aplicada y verificada en producción**. Los SQL de `20260818_TAXONOMY_V3_A16/` se conservan para trazabilidad/rollback y **no deben reejecutarse por rutina**.

## v1.5.0 — Centro de revisión / puente Anki

Ejecutar una vez antes de usar los nuevos alcances de `Revisar pregunta`:

`20260822_REVIEW_CENTER_ANKI_SCOPE_V1_5_0.sql`

La migración es idempotente y limitada a esquema:

- añade `question_review_flags.learning_scope` con `CONTENT`, `EDITORIAL_TECHNICAL` o `UNCLASSIFIED`;
- amplía el `CHECK` de `question_learning_notes.anki_action` para aceptar `REEXPOSE_EXISTING_CARD`;
- no modifica `attempts`, `practice_sessions`, `question_memory_state`, `questions`, `rentability_topics` ni taxonomía.

## Vigentes para reproducir el estado actual

Ejecutar únicamente cuando corresponda y siguiendo la documentación de cada release:

1. `20260805_FIX_SESSION_CONFLICT_PT409.sql`
2. `20260805_ADD_QUESTION_LEARNING_NOTES_V1_2_0.sql`
3. `20260805_ADD_TTS_TOPIC_CATALOG_V061.sql`
4. `20260805_FIX_TTS_TOPIC_CATALOG_READONLY_C1.sql`
5. `20260818_TAXONOMY_V3_A16/` — ya aplicada; conservar, no reejecutar rutinariamente.
6. `20260822_REVIEW_CENTER_ANKI_SCOPE_V1_5_0.sql` — requerida por v1.5.0.

Las migraciones se mantienen separadas para facilitar auditoría, idempotencia y trazabilidad.

## Históricas

`legacy/` conserva migraciones anteriores necesarias para reconstruir la evolución desde v0.5 hasta v1.0.0. No deben ejecutarse rutinariamente sobre la base vigente.

## Notas de continuidad

- El hotfix PT409 debe conservar SQLSTATE `PT409`; no existe rollback recomendado a `40001`.
- `20260805_ADD_QUESTION_LEARNING_NOTES_V1_2_0.sql` creó la tabla separada de notas personales con RLS por usuario e historial de cierre/Anki.
- El catálogo TTS V061 se conserva como capa histórica de runtime; su evolución operativa se gestiona aparte y no debe mezclarse con esta migración v1.5.0.
