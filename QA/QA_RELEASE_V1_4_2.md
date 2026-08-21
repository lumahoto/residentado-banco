# QA release v1.4.2

Fecha: 20/08/2026.

## Automatizado

- `python3 QA/qa_static.py` → PASS.
- `node QA/test_session_core.js` → PASS.
- `python3 QA/qa_browser.py` → PASS.
- `node --check app.js` → PASS.
- `node --check service-worker.js` → PASS.
- `node --check version.js` → PASS.

## Guardrails estáticos específicos v1.4.2

- mutex de outbox intra/inter-pestaña presente;
- Web Locks + fallback local;
- `CREATE_SESSION` priorizado;
- clasificación de `23503 attempts_session_id_fkey` presente;
- preservación `orphaned_session` / `SESSION_NOT_FOUND_23503` presente;
- persistencia local-first presente;
- no save remoto pre-attempt en feedback inmediato;
- checkpoint de navegación = 30 s;
- supresión de RPC sin cambios persistibles presente;
- PT409 y sesión lease previa preservados;
- `session-core.js` SHA-256 `d5875ebfdbe3b1658023617948f38c99746ca74c3412607103c28fabe156b7f5` preservado;
- `session-storage.js` SHA-256 `eed7339ad479d21cefb6429210c350f8c2fcd551d78449359798c15a405e68da` preservado.

## Pendiente tras despliegue

Smoke manual corto con dos pestañas y tres preguntas, descrito en `docs/INSTRUCCIONES_APLICACION_V1_4_2.md`. No requiere volver a exportar logs antes de comenzar a estudiar si el smoke pasa.
