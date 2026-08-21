# Residentado v1.4.2 — sincronización endurecida sobre Taxonomía V3 A16

WebApp estática del banco de Residentado Médico Perú. Esta versión parte de v1.4.1 y aplica un hotfix de sincronización: evita que varias pestañas drenen simultáneamente la outbox, repara attempts huérfanos `23503` sin bloquear la cola y reduce guardados remotos redundantes de sesión. No cambia dataset, taxonomía, Supabase, memoria, scheduler ni simulacros.

## Estado

- Frontend: `v1.4.2` / caché `residentado-v1-4-2`.
- Dataset: `QUESTIONS-TAXV3-A16-20260818-R1` sin cambios.
- Preguntas: 2.180 IDs estables.
- Taxonomía: V3 A16, 287 topics activos.
- Migración Supabase requerida por v1.4.2: **ninguna**.
- Anki/TTS: **sin cambios** en este hotfix.
- `session-core.js` y `session-storage.js`: preservados byte por byte respecto del baseline protegido v1.3.4.

## Hotfix v1.4.2: sincronización/outbox

La auditoría de 24 h confirmó tres `23503` de `attempts_session_id_fkey` y una relación alta entre `save_practice_session_state` y respuestas. v1.4.2 añade un mutex de outbox entre pestañas, prioriza `CREATE_SESSION`, preserva localmente attempts cuyo padre remoto ya no existe y retira esos poison items de la cola activa.

La sesión pasa a persistencia local-first: IndexedDB recibe el checkpoint inmediatamente; el guardado remoto se consolida. En corrección inmediata no se dispara un save remoto antes de terminar de registrar el attempt, la navegación pura usa checkpoint diferido de 30 s y los RPC sin cambios persistibles se omiten. Ocultar/cerrar la pestaña sigue forzando guardado remoto inmediato.

La paridad de práctica de v1.4.1 —incluido `No sé` en prácticas cronometradas— se conserva.

## Taxonomía V3 A16 preservada

La arquitectura v1.4.0 continúa intacta: la app carga `questions` + `rentability_topics`, compara `dataset_revision`, `taxonomy_version` y número de topics activos, valida el bundle completo y solo entonces reemplaza el corpus local en IndexedDB. La identidad del selector sigue siendo `rentability_topic_id`, con compatibilidad V2→V3 mediante aliases.

La migración original A16 se conserva en `MIGRATIONS/20260818_TAXONOMY_V3_A16/` únicamente para trazabilidad, verificación y rollback. **No debe reejecutarse para instalar v1.4.2.**

## QA

```bash
python3 QA/qa_static.py
python3 QA/qa_browser.py
node QA/test_session_core.js
```

Los checks cubren, entre otros: versión/caché, PT409, sesiones protegidas, mutex de outbox, reparación terminal de `23503`, reducción de saves redundantes, taxonomía V3, invalidación de corpus, cobertura dinámica y paridad de `No sé`.

## Publicación

1. Reemplazar el repositorio/runtime por v1.4.2 y hacer commit/push.
2. No ejecutar SQL ni modificar Supabase por este hotfix.
3. Abrir la WebApp normalmente con conexión. El nuevo nombre de caché hace que el service worker sustituya el runtime anterior.
4. Smoke recomendado: abrir dos pestañas, usar solo una; completar 3 preguntas (incluyendo `No sé`), cerrar parcial/revisar y reabrir. Confirmar progreso correcto y ausencia de sesiones duplicadas. La prueba detallada está en `docs/INSTRUCCIONES_APLICACION_V1_4_2.md`.

No ejecutar migraciones antiguas por rutina.
