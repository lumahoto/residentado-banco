# Handoff — Residentado v1.2.0

## Base obligatoria

- Continuar desde este paquete v1.2.0.
- No volver a v1.1.0-rc2 ni usar v1.1.0-rc3 como base.
- Conservar íntegramente los invariantes de v1.1.1 sobre PT409, recuperación, lease, `state_revision`, outbox y `version.js`.
- Mantener las fuentes clínicas canónicas post segunda auditoría del 4 de agosto de 2026.

## Funciones añadidas

1. Numeración visible en Cobertura canónica.
2. Revisión con salto numérico, `Última`, `Salir` y posición original en cierres parciales.
3. Notas personales de aprendizaje separadas de flags.
4. Exportación Markdown/CSV con protocolo Anki, contexto clínico, rentabilidad, progreso y trazabilidad.
5. Historial de resultados Anki por nota.

## Persistencia nueva

- Tabla: `public.question_learning_notes`.
- Migración: `MIGRATIONS/20260805_ADD_QUESTION_LEARNING_NOTES_V1_2_0.sql`.
- Una sola nota `OPEN` por usuario/pregunta.
- Estados: `OPEN`, `RESOLVED`, `DISMISSED`.
- Resultados Anki: `ALREADY_COVERED`, `UPDATE_EXISTING_CARD`, `CREATE_NEW_CARD`, `RESOLVED_WITHOUT_ANKI`.

## Invariantes que no deben romperse

1. Conflictos de sesión: PT409/HTTP 409, nunca SQLSTATE 40001.
2. Un conflicto no se encola como fallo offline.
3. Remoto con revisión superior prevalece; el local distinto se preserva como recuperación.
4. Una sesión no se edita simultáneamente desde dos pestañas.
5. El cierre valida `state_revision`.
6. `CREATE_SESSION` offline nunca usa upsert destructivo.
7. `version.js` sigue siendo la fuente única de versión/caché.
8. Mi Estado sigue siendo local.
9. Notas y flags permanecen conceptualmente y físicamente separados.
10. Ninguna tarjeta se crea automáticamente por cada nota; se deduplica contra Anki actualizado.

## QA siguiente

Ejecutar `python3 QA/qa_v1_2_0.py`, repetir smoke de navegador, dos pestañas, conflicto controlado, cierre con revisión obsoleta, creación/exportación de notas y verificación de Supabase.
