# Residentado v1.6.4 — Presentación preexamen + MEDIA134

WebApp estática del banco de Residentado Médico Perú. v1.6.4 es un parche frontend de **presentación** sobre la v1.6.3 auditada. Mantiene la planificación MEDIA134/high observada y la telemetría de decisión, y corrige dos interferencias visuales: tentativa/tachado ya no ocultan el feedback verde/rojo y la Referencia rápida QRV2 muestra el pseudo-Markdown legacy de forma legible y segura.

## Estado

- Frontend: `v1.6.4` / revisión predeploy `R1` / caché `residentado-v1-6-4-r1`.
- Dataset de producción confirmado: `QUESTIONS-PATCH-MEDIA134-A13A16-74-V002-20260903`; v1.6.4 no lo modifica.
- Preguntas: 2.180 IDs estables.
- Taxonomía: V3 A16, 287 topics activos; freeze hasta 2026-09-06.
- **No hay migración nueva en v1.6.4.**
- `session-core.js` y `session-storage.js`: preservados byte por byte respecto del baseline protegido.
- Scheduler de rescate/retención v1.5.2 y guardrails PT409/recovery: preservados.


## Presentación preexamen v1.6.4

- En práctica ordinaria, `●` es **respuesta tentativa**: solo el control se vuelve amarillo; la alternativa conserva su aspecto normal antes de responder y puede verse verde/roja después.
- `×` mantiene el tachado del texto sin aplicar opacidad global; una respuesta tachada puede seguir viéndose plenamente verde o roja durante la revisión.
- QRV2 transforma de forma segura el patrón legacy `**Etiqueta:**` en una etiqueta visual en negrita y separa esas etiquetas en unidades legibles. También admite `**énfasis**` inline sin mostrar asteriscos. Todo texto se escapa antes de insertar `<strong>`; no existe parser Markdown general.
- La mejora es de renderer/CSS: no modifica las 134 filas MEDIA ni ningún campo clínico en Supabase.

## Flujo de revisión heredado de v1.5.5

Después de responder, la secuencia pedagógica es: **Por qué la clave es correcta → Por qué no las otras → Trampa frecuente → Perla de examen → Gancho de memoria → Referencia rápida → Añadir nota → Revisar pregunta → Marcar duda → Siguiente pregunta**. La Referencia rápida queda inmediatamente después del Gancho de memoria y antes de la Nota.

En escritorio, **Marcar duda** y **Siguiente pregunta** se alinean a la derecha, igual que las demás acciones del bloque. En móvil se conserva el botón de duda a ancho completo para accesibilidad táctil. No cambia ninguna semántica de duda, Nota, flag, navegación, memoria o sesión.

## Práctica personalizada heredada de v1.5.4

La selección y la presentación son controles independientes:

- **Seleccionar preguntas por:** `Aleatorio` o `Más rentables primero`.
- **Orden dentro de la sesión:** `Aleatorio` o `Respetar selección`.
- **Mezclar alternativas:** independiente de ambas.

Los defaults siguen siendo Aleatorio/Aleatorio para conservar el comportamiento histórico. `Más rentables primero` ordena por tier canónico MUY_ALTA → ALTA → MEDIA → BAJA y por score descendente dentro del tier; no utiliza rendimiento personal ni señales del scheduler. El simulacro conserva su semántica v1.5.2.

## Referencia rápida QRV2

La explicación muestra contexto universal y una referencia en dos capas: **Núcleo rápido** y **Detalle útil**. El bloque completo **Referencia rápida** está plegado por defecto y se expande al tocar su cabecera; dentro, **Fuentes y trazabilidad** conserva su propio plegado secundario. El renderer preserva el referente específico (`comparison_title`/Entidad), Tema, Aborda, Fase, Dato pivote, perfil y siglas/epónimos. `reference_notes` se conserva en Supabase/datos para trazabilidad pero **no se renderiza en la experiencia de estudio**.

`audit_source_urls` acepta retrocompatiblemente URLs desnudas y el formato preferido `[Cita compacta](https://...)`, incluso mezclados en una misma celda. Las referencias nominadas muestran la cita compacta; las legacy mantienen fallback por hostname. Solo se aceptan `http/https`, se escapan etiqueta/URL y se deduplica por URL normalizada prefiriendo la etiqueta nominada. No hay backfill ni cambio de schema.




## Plan diario V002 v1.6.3

- `MUY_ALTA/ALTA` válida o `VALIDADA_CON_CAVEAT` nunca vista es la única high que puede bloquear la entrada a MEDIA134.
- `OBSERVADA_AMBIGUA` / `OBSERVADA_DESACTUALIZADA` de tier high permanece disponible para exposición histórica, pero se muestra en un carril separado.
- Si `highValidUnseen = 0` y faltan ≥3 días al examen, el orden operativo es: **Errores y dudas → MEDIA 134 · anclas → ALTA/MUY_ALTA observadas · exposición histórica → Repasos rentables → Automatización**.
- El bloque histórico high se limita a hasta 20 preguntas por checklist diario para no desplazar MEDIA134.
- Con ≤2 días al examen se conserva la consolidación final heredada.
- Esta corrección no cambia A16, attempts, sesiones, memoria, FSRS, due dates, simulacros ni Supabase.

## Telemetría de decisión y simulacro v1.6.2

- En simulacros, la numeración usa tres cifras (`001`, `015`, `100`). En históricos A+B se conserva la procedencia (`A-001`, `B-001`).
- La hoja de respuestas reserva espacios independientes para `⚑`, número y `?`; activar o quitar duda no cambia el ancho de la fila.
- En práctica ordinaria, cada alternativa tiene tres superficies separadas: el texto/alternativa para **respuesta definitiva**, `●` para **respuesta tentativa** y `×` para **tachado reversible**.
- `◉` y `×` no seleccionan la respuesta ni activan `?`. Persisten en `practice_sessions.state.scratch` mediante las claves compatibles `__paper_candidate__*` y `__paper_crossed__*`.
- Estas marcas son telemetría pedagógica y no modifican `uncertain_options`, `was_uncertain`, `memory_rating`, `speed_bucket` ni FSRS.
- En feedback inmediato las marcas quedan congeladas al responder, antes de ver la corrección; con corrección al final siguen editables mientras la pregunta sea editable.


## Exposición histórica y MEDIA 134 v1.6.2

- El filtro combinado **MUY_ALTA + ALTA** usa el tier A16 como autoridad. Una pregunta MEDIA o BAJA con tier explícito ya no puede entrar por el fallback histórico de corpus.
- Las preguntas `OBSERVADA_*` **sí son elegibles para exposición histórica** y pueden aparecer en `Nunca vistas`; continúan excluidas de dominio, debilidades, velocidad y repaso adaptativo. La auditoría R2/R3 también corrige las métricas por topic de Mi Estado para que Dudas/Vencidas/Máxima debilidad no reintroduzcan observadas por una vía secundaria.
- Práctica personalizada añade **Estado editorial**: Todas las históricas (por defecto), Solo válidas o Solo observadas.
- El Dashboard desglosa MUY_ALTA/ALTA no vistas en **válidas + observadas = exposición histórica pendiente**.
- Se incorpora **MEDIA 134 · anclas**: exactamente una pregunta seleccionada por cada uno de los 134 topics MEDIA del handoff del 02/09/2026. La selección 134/134 está cerrada; las primeras 60 QR profundas ya fueron aplicadas al banco mediante `QUESTIONS-PATCH-PREEXAM-AUD195-V001-20260903`.
- Las **MEDIA observadas no vistas** reciben una cola histórica complementaria. Así, pasar a MEDIA no significa elegir entre breadth temática y exposición a formas ambiguas/desactualizadas: ambas se muestran por separado.
- Plan preexamen original de v1.6.2: cerrar primero MUY_ALTA/ALTA histórica. **Esta regla queda supersedida por v1.6.3/V002**: solo high válida bloquea; high observada se intercala después de MEDIA134.
- Higiene learner-facing R3: si un campo legado aún contiene referencias como “alternativa C”, “opciones A y B” o un `audit_current_answer` prefijado por letra, la WebApp muestra el **texto real de la alternativa** en vez de la letra. El dato fuente no se muta; el saneamiento definitivo del banco queda para el próximo delta Supabase.
- En rescate high, la tarea de **ALTA/MUY_ALTA no vistas** va antes del backlog de vencidas. En fase MEDIA, **errores/dudas** van antes de la adquisición nueva.
- Las explicaciones, historial y formularios dejan de referirse a alternativas por letra cuando muestran texto learner-facing.
- `session-core.js` y `session-storage.js` permanecen protegidos y byte-idénticos.

## Dashboard preexamen v1.6.0

- Los **días al examen** se calculan por fecha local: al iniciar el 29/08, el 06/09 queda a 8 días calendario; el día del examen muestra 0 desde las 00:00.
- Una meta ideal de cobertura ya vencida deja de mostrarse como instrucción futura. Si MUY_ALTA/ALTA sigue pendiente después de la meta ideal, el Dashboard cambia automáticamente a **Rescate final de MUY_ALTA/ALTA**.
- El segundo contador también cambia con la fase: muestra días para el objetivo de cobertura, días hasta el corte de rescate ALTA o días de consolidación restantes.
- El parche no altera el cálculo de memoria, FSRS/retención, elegibilidad de repaso, orden interno de las colas ni los límites de cobertura ya existentes; corrige presentación y semántica de calendario de la planificación diaria.

## Dashboard e Historial v1.5.8

- En Inicio, el orden operativo es `HOY → Siguiente tarea/Continuar sesión → alerta académica prioritaria → Checklist`. Los avisos técnicos bloqueantes siguen apareciendo antes del plan.
- `Historial y ritmo` incorpora `Revisión del día` para la fecha seleccionada, con filtros: Todas, Erradas, Duda ?, No sé, Lentas y Revisar.
- La vista deduplica por `question_id` y usa el intento más reciente del día que cumple el criterio elegido.
- `Lentas` reutiliza la regla de velocidad ya existente; no introduce umbrales nuevos.
- La revisión del día es read-only respecto de progreso: no crea `practice_sessions`, attempts, memoria, outbox/recovery ni notas/flags automáticamente.
- El control `?` queda informativo dentro de esta vista para evitar mutar retroactivamente el intento. `Añadir nota` y `Revisar pregunta` siguen siendo acciones explícitas disponibles.

## Simulacros v1.5.9

El hub separa tres usos:

**Interfaz común v1.5.9:** cualquier simulacro nuevo —realista 2026, histórico o personalizado— abre en formato cuadernillo con hoja de respuestas. En escritorio la hoja permanece lateral; en pantallas estrechas pasa debajo para evitar overflow. La respuesta que cuenta es exclusivamente la marcada en la hoja.

En el cuadernillo cada alternativa tiene dos acciones independientes: pulsar la alternativa alterna una **respuesta tentativa (●)** y el botón **×** alterna el **tachado**. Se pueden mantener una o dos preferidas a la vez. Pulsar de nuevo × quita el tachado; si una alternativa está tachada, pulsar la propia alternativa también la recupera. Estas marcas son scratch de examen: no crean intentos ni convierten la pregunta en `? Duda`.
El `?` de pregunta se conserva como una señal independiente y persistente al guardar/reanudar el simulacro.

- **Simulacro realista 2026:** 200 preguntas, Parte A 100 preguntas / 120 min, intermedio oficial de 60 min, Parte B 100 preguntas / 120 min. Los relojes son independientes y B no puede abrirse durante A. Al iniciar B, A deja de ser editable.
- **Simulacros históricos:** A o B por separado y combinaciones A+B. El catálogo solo acepta series completas y exactamente numeradas; 2020 conserva su excepción de 90 preguntas por prueba. Las combinaciones A+B aíslan los dos bloques.
- **Entrenamiento personalizado:** conserva cantidad, filtros, tiempo y descanso configurables; 80 preguntas sigue siendo un preset de entrenamiento, no una réplica oficial.

La pantalla **Revisión antes de entregar** consume tiempo del bloque activo. Si termina el tiempo de A se pasa al intermedio; si termina el tiempo de B se entrega el examen. El intermedio muestra 60 minutos y permite continuar antes únicamente como atajo voluntario de entrenamiento.

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
