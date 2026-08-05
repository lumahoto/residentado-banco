# Migraciones v1.1.1

20260805_FIX_SESSION_CONFLICT_PT409.sql es idempotente y reproduce el hotfix aplicado.

No se incluye rollback a 40001 porque reintroduciria la causa del incidente. Cualquier rollback de frontend debe conservar la funcion con PT409.

## v1.2.0 — notas personales de aprendizaje

Ejecutar `20260805_ADD_QUESTION_LEARNING_NOTES_V1_2_0.sql` una sola vez antes de usar las notas en la cuenta. La migración es idempotente, crea una tabla separada de los flags de auditoría, aplica RLS por usuario y conserva el historial de cierre/Anki.

## Catálogo TTS V061 — aplicado y verificado el 5 de agosto de 2026

- `20260805_ADD_TTS_TOPIC_CATALOG_V061.sql`: crea y carga `public.tts_topic_catalog` con TTS_001–089.
- `20260805_FIX_TTS_TOPIC_CATALOG_READONLY_C1.sql`: retira privilegios heredados y deja SELECT únicamente para `authenticated`.
- Estado confirmado: 89 filas, 0 IDs sin correspondencia, RLS activo, 1 política SELECT, 0 políticas de escritura y control solo lectura PASS.
- No volver a ejecutar por rutina durante el despliegue v1.3.0; se conservan aquí para trazabilidad.

