# Validacion - Residentado v1.1.1

## Automatico

Se ejecutaron node --check en app.js, session-core.js, session-storage.js, service-worker.js, version.js, question-parser.js, w3-tools.js y w4-data.js.

Los tests de session-core verifican: remoto superior vence a local conflictivo inferior; local pending de igual revision se conserva; el fingerprint ignora timestamps volatiles y detecta progreso distinto.

Comando: python3 QA/qa_v1_1_1.py
Resultado esperado: QA v1.1.1: OK

## Supabase ya verificado

usa_pt409=true y elimino_40001=true.

## Manual despues de desplegar

A. Confirmar v1.1.1 y cache nueva.
B. No borrar IndexedDB; comprobar recuperacion local si existe diferencia.
C. Responder y navegar rapido: los guardados deben consolidarse.
D. Abrir la misma sesion en otra pestana: debe bloquearse.
E. Forzar revision obsoleta: debe devolver PT409, crear una recuperacion y no repetir la outbox.
F. Cerrar con revision obsoleta: no debe sobrescribir; debe recuperar y reintentar una vez.
G. Observar logs cinco minutos: sin crecimiento continuo de errores.

## Limite

La QA automatica no se conecto al Supabase real ni ejecuto una sesion del usuario. La prueba manual posterior al despliegue sigue siendo obligatoria.
