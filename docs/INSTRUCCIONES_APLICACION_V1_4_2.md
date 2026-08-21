# Residentado WebApp v1.4.2 — hardening de sincronización y outbox

Fecha: 20 de agosto de 2026.  
Base: v1.4.1.

## Objetivo

Resolver dos defectos confirmados al auditar `supabase_logs.csv` de 24 horas y reducir escrituras remotas evitables sin cambiar banco, taxonomía, memoria, scheduler, Anki, TTS ni Supabase.

Evidencia del log auditado: 596 eventos; 527 API/Edge y 69 PostgreSQL. `save_practice_session_state` concentró 160 eventos (157 POST, 156 exitosos y 1 PT409), mientras `attempts` registró tres fallos 409 asociados a SQLSTATE `23503` / `attempts_session_id_fkey`. La descarga completa de `questions` no se repetía: hubo una sola GET específica más su preflight.

## Cambios

### 1. Outbox segura entre pestañas

- `processSessionOutbox()` queda serializado dentro de la pestaña y entre pestañas.
- Se usa Web Locks (`navigator.locks`) cuando está disponible.
- Existe fallback de lease en `localStorage`.
- `CREATE_SESSION` se procesa antes que las operaciones que dependen de la sesión aunque haya sido encolado después.

Esto permite mantener varias instancias abiertas sin que dos pestañas intenten drenar simultáneamente la misma outbox.

### 2. Reparación de `23503 attempts_session_id_fkey`

Ante un `INSERT_ATTEMPT` que falla por ausencia de su `practice_session`:

1. se comprueba si la sesión ya existe remotamente;
2. si existe, se hace un único reintento del attempt;
3. si no existe, el attempt se conserva en IndexedDB como `orphaned_session` con `SESSION_NOT_FOUND_23503`;
4. se retira únicamente la operación envenenada de la outbox activa para que el resto pueda seguir sincronizando.

No se borra silenciosamente la respuesta local y no se crea un bucle de reintentos.

### 3. Menos `save_practice_session_state`

- Persistencia **local-first**: las interacciones relevantes se guardan de inmediato en IndexedDB.
- En corrección inmediata, elegir alternativa / `No sé` / timeout ya no inicia un guardado remoto antes de terminar de registrar el attempt.
- La navegación pura usa un checkpoint remoto diferido de 30 s; responder la siguiente pregunta lo consolida antes. Ocultar/cerrar/pausar sigue forzando guardado inmediato.
- Se omite el RPC si el payload persistible es idéntico al último estado remoto conocido.
- Si el usuario avanza mientras un RPC está en vuelo, un shadow local más nuevo no es pisado por la respuesta remota anterior.

## No cambia

- dataset `QUESTIONS-TAXV3-A16-20260818-R1`;
- taxonomía V3 A16 / 287 topics activos;
- PT409 y control optimista por `state_revision`;
- lease por sesión ya existente;
- algoritmos de memoria y selección adaptativa;
- `No sé` de v1.4.1;
- simulacros;
- esquema Supabase.

## Despliegue

No requiere SQL ni migración.

1. Reemplazar el runtime/repo por v1.4.2 y publicar normalmente.
2. Abrir la WebApp con conexión y confirmar que el pie muestra `v1.4.2`.
3. No borrar IndexedDB ni el progreso local.
4. No reejecutar migraciones antiguas.

## Smoke mínimo antes de banquear

1. Abrir dos pestañas de la WebApp; usar solo una.
2. En la pestaña activa crear práctica de 3 preguntas con corrección inmediata.
3. Responder una normal, una con `No sé` y una tercera normal; navegar entre ellas.
4. Confirmar que no aparecen errores visibles ni sesiones duplicadas.
5. Cerrar parcialmente y revisar respondidas; luego salir.
6. Reabrir la WebApp y confirmar que el progreso/sesión se conserva correctamente.

La comprobación fina de reducción de tráfico puede hacerse después de estudiar; no es requisito para comenzar a banquear si el smoke anterior pasa.
