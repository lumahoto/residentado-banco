# QA release v1.5.0 — 2026-08-22

Base: v1.4.3 R2.
Release: `REL-20260822-V1.5.0-REVIEW-CENTER-STUDY-LOOP`.

## Automatizado

- `node --check app.js` → PASS
- `node --check version.js` → PASS
- `node --check service-worker.js` → PASS
- `node QA/test_session_core.js` → PASS
- `python3 QA/qa_static.py` → PASS
- `python3 QA/qa_browser.py` → PASS

## Guardrails verificados por QA estático

- hashes protegidos de `session-core.js` y `session-storage.js` sin cambios;
- PT409/recovery idempotente preservado;
- autocierre por cambio de día no llama `ensureStudyAttempts`, `ensureExamAttempts` ni escribe en `attempts`;
- cierre diario usa operación `statusOnly` y no crea recovery por conflicto de revisión;
- Centro de revisión y filtros presentes;
- `?` por alternativa ausente y controles de duda a nivel de pregunta presentes;
- `CONTENT` / `EDITORIAL_TECHNICAL` presentes;
- resultados nuevos de nota limitados a crear/actualizar/reexponer;
- migración v1.5.0 presente y sin escrituras sobre `attempts` o `question_memory_state`.

## Smoke de navegador verificado

- versión v1.5.0 visible;
- práctica personalizada cronometrada mantiene `No sé`;
- no existe control `?` por alternativa;
- existe `?` superior de pregunta;
- `?` persiste al responder `No sé` y aparece sincronizado después de la explicación;
- cierre parcial abre primero el Centro de revisión;
- hoja informativa y filtros se renderizan;
- `Revisar pregunta → Contenido / duda` crea/reutiliza Nota de aprendizaje;
- filtros Notas y Revisar reflejan el estado creado.

## Pendiente post-deploy

Validación manual contra Supabase real y cambio de fecha real/simulado según `docs/INSTRUCCIONES_APLICACION_V1_5_0.md`.
