# QA release v1.5.1 — 2026-08-26

Base: v1.5.0.
Release: `REL-20260826-V1.5.1-PREEXAM-SCHEDULER-RESCUE`.

## Objetivo

Corregir starvation de repasos antiguos de alta rentabilidad y evitar que una fecha rígida detenga cobertura útil mientras aún quedan preguntas MUY_ALTA/ALTA o MEDIA rentable sin primera exposición.

## Automatizado

- `node --check app.js` → PASS
- `node --check version.js` → PASS
- `node --check service-worker.js` → PASS
- `node QA/test_session_core.js` → PASS
- `python3 QA/qa_static.py` → PASS
- `python3 QA/qa_browser.py` → PASS

## Guardrails verificados

- memoria matemática sin cambios;
- sin SQL nuevo;
- sin cambios en banco/taxonomía;
- `session-core.js` y `session-storage.js` protegidos y sin cambios;
- PT409/recovery/cierre diario preservados;
- anti-starvation presente en `smartPool('due')`;
- cobertura dinámica relativa a la fecha de examen;
- tope de nuevas de rescate = 120/día;
- tope de vencidas de rescate = 140/día;
- simulacros sin cambios.

## Validación contra snapshot real 26/08

- corpus válido: 1.899;
- vistas válidas: 1.016;
- sin ver válidas: 883;
- ALTA sin primera exposición: 297;
- vencidas válidas: 564;
- vencidas MUY_ALTA/ALTA: 448;
- objetivo calculado v1.5.1 para nuevas el 26/08: 99;
- objetivo calculado v1.5.1 para vencidas el 26/08: 140.

Detalles: `docs/SCHEDULER_AUDIT_20260826.md`.

## Pendiente post-deploy

Smoke manual corto: abrir el plan del día, confirmar `Rescate ALTA + memoria`, inspeccionar las primeras preguntas de `Repasos rentables`, responder 5–10, usar `Continuar después` y confirmar reanudación de la misma sesión durante el día.
