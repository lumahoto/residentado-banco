# Migraciones v1.1.1

20260805_FIX_SESSION_CONFLICT_PT409.sql es idempotente y reproduce el hotfix aplicado.

No se incluye rollback a 40001 porque reintroduciria la causa del incidente. Cualquier rollback de frontend debe conservar la funcion con PT409.

## v1.2.0 — notas personales de aprendizaje

Ejecutar `20260805_ADD_QUESTION_LEARNING_NOTES_V1_2_0.sql` una sola vez antes de usar las notas en la cuenta. La migración es idempotente, crea una tabla separada de los flags de auditoría, aplica RLS por usuario y conserva el historial de cierre/Anki.
