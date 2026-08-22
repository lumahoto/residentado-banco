# Residentado v1.5.0 — Centro de revisión y circuito WebApp → Anki

WebApp estática del banco de Residentado Médico Perú. Esta versión parte de **v1.4.3 R2** y mejora el flujo de revisión/estudio sin modificar el banco canónico, la taxonomía V3 A16, la rentabilidad, el algoritmo de memoria ni el scheduler.

## Estado

- Frontend: `v1.5.0` / caché `residentado-v1-5-0`.
- Dataset: `QUESTIONS-TAXV3-A16-20260818-R1` sin cambios.
- Preguntas: 2.180 IDs estables.
- Taxonomía: V3 A16, 287 topics activos; freeze hasta 2026-09-06.
- Migración Supabase requerida por v1.5.0: `MIGRATIONS/20260822_REVIEW_CENTER_ANKI_SCOPE_V1_5_0.sql`.
- `session-core.js` y `session-storage.js`: preservados byte por byte respecto del baseline protegido.
- Guardrails PT409/recovery de v1.4.3: preservados.

## Centro de revisión

La misma interfaz se reutiliza después de completar una sesión, después de un cierre parcial y al abrir una sesión desde **Historial**. El resumen muestra una hoja informativa con número original, estado, Tema y Entidad cuando está disponible.

Filtros iniciales: `Todas`, `Incorrectas`, `No sé`, `? Duda`, `Notas`, `Marcadas`, `Revisar` y `Auditoría`. Al entrar a un filtro, Anterior/Siguiente recorre solo ese subconjunto y conserva la posición original de la pregunta dentro de la sesión.

## Marcador `?`

`?` ahora pertenece a la **pregunta completa**, no a cada alternativa. Existe un control arriba de la pregunta y otro después de la explicación; ambos representan el mismo estado y se sincronizan.

El marcador es deliberadamente ligero: no genera explicación, nota, flag de auditoría ni tarjeta Anki. Para registrar contenido se usan **Nota** o **Revisar pregunta**.

## Notas / Revisar pregunta → Anki

`Revisar pregunta` distingue:

- `Contenido / duda`: crea o reutiliza una nota de aprendizaje y entra obligatoriamente al flujo Anki.
- `Editorial / técnico`: se conserva solo para auditoría.

Toda nota conceptual nueva debe cerrarse con una intervención Anki:

- `CREATE_NEW_CARD`
- `UPDATE_EXISTING_CARD`
- `REEXPOSE_EXISTING_CARD`

Si el conocimiento ya existe correctamente en Anki, no se duplica; se reexpone la tarjeta existente con prioridad inmediata. Los outcomes históricos anteriores siguen siendo legibles, pero no se ofrecen para nuevos cierres.

## `Continuar después` y cambio de día

Una sesión dejada en `Continuar después` solo es reanudable durante el mismo día local. Al detectarse el cambio de día:

- si tiene respuestas, pasa a **cierre parcial** y queda revisable en Historial;
- si tiene 0 respuestas, pasa a `abandoned` y no ensucia el Historial útil;
- el autocierre genera **0 attempts nuevos** y no actualiza memoria por respuestas heredadas;
- un conflicto de `state_revision` durante este autocierre no crea una recovery: se relee el remoto y se reintenta únicamente la transición de estado.

## Migración Supabase

Ejecutar una vez, antes de usar los nuevos alcances de `Revisar pregunta`:

```sql
-- archivo completo: MIGRATIONS/20260822_REVIEW_CENTER_ANKI_SCOPE_V1_5_0.sql
```

La migración solo añade `question_review_flags.learning_scope` y amplía el `CHECK` de `question_learning_notes.anki_action` para aceptar `REEXPOSE_EXISTING_CARD`. No modifica `attempts`, `question_memory_state`, preguntas ni taxonomía.

## QA

```bash
python3 QA/qa_static.py
python3 QA/qa_browser.py
node QA/test_session_core.js
```

## Publicación

1. Ejecutar la migración v1.5.0 en Supabase y verificarla.
2. Reemplazar el repositorio por este build y hacer commit/push.
3. Abrir la WebApp normalmente con conexión; el nombre nuevo de caché fuerza la sustitución del runtime anterior.
4. Realizar el smoke de `docs/INSTRUCCIONES_APLICACION_V1_5_0.md`.

No reejecutar migraciones antiguas por rutina.
