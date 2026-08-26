# Aplicación y smoke test — Residentado v1.5.1

## Antes de publicar

1. Confirmar que v1.5.0 ya estaba operativo.
2. No ejecutar SQL nuevo para v1.5.1.
3. Ejecutar `python3 QA/qa_static.py`, `python3 QA/qa_browser.py` y `node QA/test_session_core.js`.
4. Publicar el build v1.5.1 en GitHub.

## Smoke del scheduler

1. Abrir Inicio y verificar que la versión visible sea v1.5.1.
2. Abrir el plan automático del día.
3. Si quedan MUY_ALTA/ALTA sin ver, confirmar que la fase diga **Rescate ALTA + memoria** aunque se haya superado el antiguo corte examen-10.
4. Abrir `🧠 Repasos rentables` y verificar que aparecen preguntas antiguas MUY_ALTA/ALTA dentro de las primeras posiciones, no solo las repetidas recientemente.
5. Responder 5–10 y usar `Continuar después`; reabrir el mismo bloque el mismo día y confirmar que continúa la misma sesión.
6. Cerrar parcial y verificar que no se materializan respuestas no contestadas.
7. Confirmar que no cambió el contenido de simulacros ni el Centro de revisión.

## Integridad

No borrar ni reconstruir manualmente `question_memory_state`. El despliegue cambia selección futura; no reprograma retroactivamente la memoria.
