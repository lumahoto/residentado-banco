# Residentado WebApp v1.4.1 — paridad funcional de práctica

Fecha: 18 de agosto de 2026.
Base: v1.4.0.

## Objetivo

Corregir una inconsistencia de interfaz y registro: `No sé` estaba limitado por código a `timeMode = none`, por lo que desaparecía en prácticas con cronómetro aunque `No sé` es una capacidad canónica de práctica.

## Cambio aplicado

`🤷 No sé` aparece ahora en todas las sesiones que usan el motor de práctica (`launchStudy`):

- práctica adaptativa;
- práctica personalizada;
- práctica por tema;
- sprints;
- entrenamiento de velocidad;
- sesiones con tiempo por pregunta;
- sesiones con tiempo total;
- corrección inmediata o al final.

Semántica: pulsarlo registra una respuesta incorrecta explícita, no una pregunta en blanco y no un timeout. Si hay cronómetro, se conserva el tiempo real usado hasta pulsar `No sé`.

Los simulacros estándar e históricos no se modifican: conservan su formato especial.

## Despliegue

No requiere SQL ni cambios de Supabase. Reemplazar los archivos del repositorio por v1.4.1 y publicar normalmente. El cambio de `version.js` y del nombre de caché del service worker fuerza la actualización del runtime.

## Smoke manual recomendado

1. Crear práctica personalizada de 10 preguntas, tiempo por pregunta, 10–25 segundos y corrección inmediata. Confirmar que aparece `No sé`.
2. Pulsar `No sé` antes de que termine el cronómetro. Debe mostrar la corrección y quedar como `No sé`, no como `Tiempo agotado`.
3. Crear otra práctica con corrección al final y tiempo por pregunta. Confirmar botón `No sé · continuar`, avanzar, volver atrás y comprobar que la respuesta puede cambiarse antes de entregar.
4. Probar un Sprint 10 o Entrenamiento de velocidad: también debe aparecer `No sé`.
5. Abrir un simulacro: confirmar que su interfaz no cambió.
