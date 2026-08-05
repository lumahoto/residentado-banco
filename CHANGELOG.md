# Changelog - Residentado

## v1.3.0 - 2026-08-05

Release funcional construido sobre v1.2.0. Conserva sus funciones y todos los guardrails de v1.1.1.

- integra `public.tts_topic_catalog` como fuente autoritativa online de disponibilidad TTS;
- carga el catálogo una vez por sincronización y no por fila o vista;
- conserva respaldo local V061 con 274 temas y TTS_001–089 disponibles;
- actualiza Tu mapa actual de debilidades con código y estado TTS;
- añade columna TTS a Mi Estado → Cobertura canónica;
- añade conteo TTS en la vista agrupada por especialidad;
- añade estado y pedido TTS en el detalle de tema;
- mantiene Mi Estado calculado localmente y sin polling;
- no modifica corpus, progreso, sesiones, memoria, flags ni notas.

## v1.2.0 - 2026-08-05

Release funcional construido sobre v1.1.1. Conserva todos los guardrails de sesiones y añade:

- numeración de Cobertura canónica;
- salto directo, Última y Salir en revisión;
- posición original para cierres parciales;
- notas personales de aprendizaje separadas de flags;
- exportación Markdown/CSV con protocolo Anki y trazabilidad;
- migración RLS `question_learning_notes`;
- QA estático, unitario y smoke headless.

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
