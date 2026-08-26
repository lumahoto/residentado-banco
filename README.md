# Residentado v1.5.3 — Práctica personalizada + QRV2

WebApp estática del banco de Residentado Médico Perú. v1.5.3 parte del **baseline real v1.5.2** y reconcilia la selección de práctica personalizada, el renderer QRV2 y la separación estricta entre flags de auditoría y Notas. Mantiene sin cambios banco canónico, Taxonomía V3 A16, fórmula de memoria, scheduler preexamen y guardrails de sesiones/PT409.

## Estado

- Frontend: `v1.5.3` / caché `residentado-v1-5-3`.
- Dataset: `QUESTIONS-TAXV3-A16-20260818-R1` sin cambios.
- Preguntas: 2.180 IDs estables.
- Taxonomía: V3 A16, 287 topics activos; freeze hasta 2026-09-06.
- **No hay migración nueva en v1.5.3.**
- `session-core.js` y `session-storage.js`: preservados byte por byte respecto del baseline protegido.
- Scheduler de rescate/retención v1.5.2 y guardrails PT409/recovery: preservados.

## Práctica personalizada v1.5.3

La selección y la presentación son controles independientes:

- **Seleccionar preguntas por:** `Aleatorio` o `Más rentables primero`.
- **Orden dentro de la sesión:** `Aleatorio` o `Respetar selección`.
- **Mezclar alternativas:** independiente de ambas.

Los defaults siguen siendo Aleatorio/Aleatorio para conservar el comportamiento histórico. `Más rentables primero` ordena por tier canónico MUY_ALTA → ALTA → MEDIA → BAJA y por score descendente dentro del tier; no utiliza rendimiento personal ni señales del scheduler. El simulacro conserva su semántica v1.5.2.

## Referencia rápida QRV2

La explicación vuelve a mostrar contexto universal y una referencia en dos capas: **Núcleo rápido** y **Detalle útil**. El renderer preserva el referente específico (`comparison_title`/Entidad), Tema, Aborda, Fase, Dato pivote, perfil, siglas/epónimos, `reference_notes` como **Notas generales** y `audit_source_urls` como **Fuentes y trazabilidad**. Si falta contenido estructurado, indica pendiente de migración en vez de inventar contenido clínico.

## Centro de revisión

La misma interfaz se reutiliza después de completar una sesión, después de un cierre parcial y al abrir una sesión desde **Historial**. El resumen muestra una hoja informativa con número original, estado, Tema y Entidad cuando está disponible.

Filtros iniciales: `Todas`, `Incorrectas`, `No sé`, `? Duda`, `Notas`, `Marcadas`, `Revisar` y `Auditoría`. Al entrar a un filtro, Anterior/Siguiente recorre solo ese subconjunto y conserva la posición original de la pregunta dentro de la sesión.

## Marcador `?`

`?` ahora pertenece a la **pregunta completa**, no a cada alternativa. Existe un control arriba de la pregunta y otro después de la explicación; ambos representan el mismo estado y se sincronizan.

El marcador es deliberadamente ligero: no genera explicación, nota, flag de auditoría ni tarjeta Anki. Para registrar una duda personal se usa **Nota**; para auditar el banco se usa **Revisar pregunta**.

## Notas y Revisar pregunta

Son carriles independientes:

- `Revisar pregunta → Contenido clínico`: observación del banco/contenido; **no crea Nota ni obliga Anki**.
- `Revisar pregunta → Editorial / técnico`: observación de presentación o interfaz.
- `Nota de aprendizaje`: solo se crea explícitamente cuando el usuario registra una duda personal.

Las Notas conceptuales existentes conservan su flujo de cierre con una intervención Anki:

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

1. Si v1.5.0 ya estaba operativo, **no ejecutar SQL nuevo**.
2. Reemplazar el repositorio por este build y hacer commit/push.
3. Abrir la WebApp normalmente con conexión; el nombre nuevo de caché fuerza la sustitución del runtime anterior.
4. Realizar el smoke de `docs/INSTRUCCIONES_APLICACION_V1_5_1.md`.

No reejecutar migraciones antiguas por rutina.
