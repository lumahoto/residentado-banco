# Migraciones v1.1.1

20260805_FIX_SESSION_CONFLICT_PT409.sql es idempotente y reproduce el hotfix aplicado.

No se incluye rollback a 40001 porque reintroduciria la causa del incidente. Cualquier rollback de frontend debe conservar la funcion con PT409.
