# Decision log — WebApp v1.5.1

## Problema observado

La auditoría del 26/08/2026 mostró backlog vencido MUY_ALTA/ALTA y preguntas antiguas que no llegaban a las colas recientes, mientras aún quedaban preguntas de alta rentabilidad sin primera exposición. Las sesiones parciales hacían especialmente importante el orden de las primeras posiciones de cada cola.

## Decisión

1. No reemplazar la memoria propia por FSRS ni resetear `question_memory_state` a pocos días del examen.
2. Mantener la estimación de recuerdo y los objetivos de retención existentes.
3. Corregir solo selección/plan diario: cobertura dinámica + recuperación vencida en paralelo.
4. Añadir anti-starvation para preguntas MUY_ALTA/ALTA vencidas antiguas.
5. Priorizar primera vuelta MUY_ALTA/ALTA antes de MEDIA; BAJA no prolonga la fase intensiva.

## Guardrails

- cero cambios en `attempts` históricos o `question_memory_state` por despliegue;
- cero migraciones nuevas;
- `session-core.js` y `session-storage.js` byte-idénticos;
- simulacros no cambian;
- la mejora afecta la selección de prácticas automáticas, no la clave ni contenido de preguntas.
