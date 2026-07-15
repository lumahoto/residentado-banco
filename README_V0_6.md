# Residentado app v0.6

## Nuevo: Simulacro histórico realista

La sección **Simulacro** ahora ofrece:

- Pruebas históricas completas por año y serie (A/B) cuando estén completamente cargadas.
- Maratón A+B cuando ambas pruebas del año estén disponibles.
- Preguntas en el orden original.
- Cuadernillo completo visible, con alternativas no clicables.
- Hoja de respuestas independiente en el lateral.
- Sin claves ni explicaciones hasta entregar.
- Persistencia en `practice_sessions` para reanudar.
- En la maratón A+B se ofrece descanso entre ambas pruebas.

La app detecta automáticamente qué exámenes históricos están completos en la tabla `questions`.

## Escalabilidad

La carga de preguntas, intentos y estados de memoria ahora usa paginación para superar el límite de 1000 filas por consulta.
