# Decision log — WebApp v1.5.0

Fecha: 2026-08-22.
Base: v1.4.3 R2.

## Decisiones aprobadas

1. Existe una sola vista informativa del Centro de revisión; no se mantiene una vista compacta alternativa.
2. El Centro de revisión es compartido por sesión completa, cierre parcial e Historial.
3. Cada fila prioriza número original y estados, y muestra Tema + Entidad cuando existe sin añadir Área/Especialidad a la lista.
4. `?` es un estado de duda de la pregunta completa. Se controla arriba y después de la explicación. No genera contenido ni auditoría.
5. `Notas` representa necesidad explícita de aprendizaje.
6. `Revisar pregunta` distingue `CONTENT` de `EDITORIAL_TECHNICAL`.
7. Toda observación `CONTENT` debe tener una nota de aprendizaje y terminar en Anki como nueva tarjeta, actualización o reexposición tras deduplicación.
8. `Continuar después` caduca al cambiar el día local. Con respuestas → cierre parcial; sin respuestas → abandono.
9. El autocierre diario no materializa attempts ni memoria. Un conflicto de revisión en ese cierre no crea recovery.
10. Se mantienen íntegros los guardrails PT409 de v1.4.3 R2 y no se modifican `session-core.js` ni `session-storage.js`.
11. No se modifica el freeze de Taxonomía V3 A16 ni el dataset canónico.

## Caveat histórico

Los attempts existentes no guardan una copia completa de la versión textual de cada pregunta. Desde v1.5.0 las nuevas sesiones guardan `datasetRevision` en `config`; en sesiones posteriores, si el corpus cambió, Historial muestra una advertencia a nivel de sesión sin fingir una reconstrucción exacta del texto histórico.
