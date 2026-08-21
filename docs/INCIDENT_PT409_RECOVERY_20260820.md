# Incidente PT409 / recovery replay — 20 de agosto de 2026

## Evidencia confirmada

Entre 2026-08-21 01:51:23 y 01:51:29 UTC (20:51:23–20:51:29 America/Lima) Supabase registró siete errores `PT409` con mensaje `SESSION_REVISION_CONFLICT_OR_NOT_ACTIVE`. Cada error fue seguido 82–197 ms después por una sesión `· recuperación local` con `reason = outbox_revision_conflict` en WebApp v1.4.2.

Las siete recuperaciones eran snapshots prefijo de sesiones fuente ya más avanzadas/cerradas: 39/40, 26/27, 4/4, 33/34, 2/2, 46/50 y 8/17 respuestas. Al cerrarlas, v1.4.2 resolvía la existencia de attempts solo por el `session_id` de la recuperación. Como los estados heredaban `attempt_id` y `client_attempt_id`, el upsert reutilizó attempts históricos bajo un `session_id` nuevo y con `answered_at` fresco.

Baseline de la exportación 2026-08-21 12:33–12:35:

- practice_sessions: 88;
- attempts: 3132;
- question_memory_state: 1016;
- sesiones técnicas demostradas: 7;
- attempt rows actualmente enlazados a ellas: 156;
- preguntas distintas afectadas: 122;
- attempts del 20/08 antes del incidente: 34;
- attempts legítimos posteriores al incidente en la exportación: 18;
- attempts artificialmente fechados 20:52–20:53: 156.

## Política de reparación

No borrar los 156 attempts: son identidades históricas reutilizadas. La reparación devuelve cada fila a la sesión fuente inmediata que la contenía antes del incidente y reconstruye un timestamp histórico conservador dentro de esa sesión.

La reconstrucción temporal usa el primer attempt intacto posterior al prefijo como ancla; si no existe cola intacta, usa `completed_at` de la sesión fuente. Los attempts del prefijo se colocan un segundo antes del ancla, manteniendo su orden por `session_question_index`. Esto evita afirmar una precisión temporal que ya no existe en Supabase y conserva orden/fecha histórica.

Luego se invalidan únicamente los 122 `question_memory_state` afectados. La WebApp v1.4.3 reconstruye esos estados de forma determinista desde `attempts` mediante `reconcileMemoryFromAttempts()`.

Las otras recuperaciones históricas no se modifican porque no existe evidencia suficiente para clasificarlas todas como falsas.

## Fix preventivo v1.4.3

1. Si el remoto ya contiene todo el snapshot local atrasado, se acepta el remoto y se retira el outbox sin crear recuperación.
2. `attempt_id` / `client_attempt_id` se tratan como identidad global del attempt, no como identidad dependiente de la sesión actual.
3. Cerrar una recuperación con respuestas heredadas no reescribe attempts históricos.
4. Si el usuario cambia explícitamente una respuesta heredada, se separa la identidad heredada para crear un attempt realmente nuevo.
5. Si una recuperación contiene una identidad histórica que no puede cargarse, se rechaza fabricar un duplicado.

Los SQL de reparación, rollback y mapa forense están en `OPERATIONS/20260821_PT409_RECOVERY_REPAIR/`.


## Compatibilidad SQL — 2026-08-21

El primer borrador del repair usaba `jsonb_object_length()`, función no disponible en la instancia actual. V002 cuenta las claves de `state.responses` mediante `jsonb_object_keys(...)` + `count(*)`. Este cambio solo afecta la construcción del mapa forense; no cambia la lógica de reparación.
