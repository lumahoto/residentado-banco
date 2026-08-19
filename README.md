# Residentado v1.4.1 — paridad funcional de práctica sobre Taxonomía V3 A16

WebApp estática del banco de Residentado Médico Perú. Esta versión parte del ZIP v1.4.0 del 18/08/2026 y aplica un hotfix de uniformidad de capacidades en las sesiones de práctica, sin cambiar el dataset, la taxonomía, Supabase, memoria, scheduler ni los simulacros.

## Estado

- Frontend: `v1.4.1` / caché `residentado-v1-4-1`.
- Dataset: `QUESTIONS-TAXV3-A16-20260818-R1` sin cambios.
- Preguntas: 2.180 IDs estables.
- Taxonomía: V3 A16, 287 topics activos.
- Migración Supabase requerida por v1.4.1: **ninguna**.
- Anki/TTS: **sin cambios** en este hotfix.
- `session-core.js` y `session-storage.js`: preservados byte por byte respecto del baseline protegido v1.3.4.

## Hotfix v1.4.1: práctica uniforme

`🤷 No sé` forma parte de las capacidades canónicas de práctica. En v1.4.0 el render y el handler lo limitaban por error a `timeMode = none`, de modo que desaparecía en práctica personalizada cronometrada, sprints y entrenamiento de velocidad.

Desde v1.4.1 aparece en todo flujo que usa `launchStudy`:

- práctica adaptativa;
- práctica personalizada;
- práctica por tema;
- sprints y velocidad;
- sin límite, por pregunta o con tiempo total;
- corrección inmediata o al final.

Pulsar `No sé` registra una respuesta incorrecta explícita; no una pregunta en blanco y no un timeout. Si existe cronómetro, se conserva el tiempo real transcurrido hasta pulsarlo. Los simulacros estándar e históricos conservan su formato especial y no fueron modificados.

## Taxonomía V3 A16 preservada

La arquitectura v1.4.0 continúa intacta: la app carga `questions` + `rentability_topics`, compara `dataset_revision`, `taxonomy_version` y número de topics activos, valida el bundle completo y solo entonces reemplaza el corpus local en IndexedDB. La identidad del selector sigue siendo `rentability_topic_id`, con compatibilidad V2→V3 mediante aliases.

La migración original A16 se conserva en `MIGRATIONS/20260818_TAXONOMY_V3_A16/` únicamente para trazabilidad, verificación y rollback. **No debe reejecutarse para instalar v1.4.1.**

## QA

```bash
python3 QA/qa_static.py
python3 QA/qa_browser.py
node QA/test_session_core.js
```

Los checks cubren, entre otros: versión/caché, PT409, sesiones protegidas, taxonomía V3, invalidación automática de corpus, cobertura dinámica, filtros por tier y la nueva paridad de `No sé` en práctica cronometrada.

## Publicación

1. Reemplazar el repositorio/runtime por v1.4.1 y hacer commit/push.
2. No ejecutar SQL ni modificar Supabase por este hotfix.
3. Abrir la WebApp normalmente con conexión. El nuevo nombre de caché hace que el service worker sustituya el runtime anterior.
4. Smoke recomendado: práctica personalizada cronometrada → confirmar `No sé`; pulsarlo antes del timeout → debe figurar como `No sé`, no como `Tiempo agotado`; abrir luego un simulacro y confirmar que su interfaz permanece igual.

No ejecutar migraciones antiguas por rutina.
