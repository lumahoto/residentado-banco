# Changelog - Residentado

## v1.1.1 - 2026-08-05

Primera base estable posterior a v1.1.0-rc2. v1.1.0 no se promueve a estable por INC-20260805-SESSION-40001.

### Persistencia de sesiones

- FIX-SESSION-001: PT409/HTTP 409 reemplaza SQLSTATE 40001.
- FIX-SESSION-002: se detienen guardados contra una revision obsoleta.
- FIX-SESSION-003: un conflicto no entra en la outbox como fallo de red.
- FIX-SESSION-004: la revision remota superior prevalece; el estado local distinto se conserva como recuperacion.
- FIX-SESSION-005: lease por pestana con localStorage y BroadcastChannel.
- FIX-SESSION-006: CREATE_SESSION offline usa INSERT, nunca upsert destructivo.
- FIX-SESSION-007: beforeunload no lanza un segundo guardado asincrono.
- FIX-SESSION-008: el cierre valida state_revision y recupera antes de reintentar.

### Optimizacion y publicacion

- OPT-SAVE-001: debounce de 1 segundo y deduplicacion de eventos de salida.
- FIX-RELEASE-001: version.js es fuente canonica; navegacion network-first.
- VERIFY-EGRESS-001: corpus condicionado por manifiesto e IndexedDB; sin polling completo.
- VERIFY-STATE-001: Mi Estado se calcula localmente.

## v1.1.0-rc2 - retirada

Se retiro porque un conflicto funcional usaba SQLSTATE 40001 y podia disparar reintentos internos masivos.
