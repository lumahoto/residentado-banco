# ADENDA DE PRECEDENCIA — WEBAPP v1.3.0 Y CATÁLOGO TTS EN SUPABASE

Fecha: 5 de agosto de 2026.

Esta adenda actualiza únicamente la relación entre TTS, Supabase y la webapp. Conserva las reglas clínicas, editoriales, Anki, sesiones y notas del Contexto Maestro A12.

## Estado autoritativo

1. La versión funcional vigente pasa a ser **Residentado v1.3.0**.
2. La base directa es Residentado v1.2.0 del archivo `260805_residentado-banco-main.zip`.
3. Se conserva la base técnica de seguridad v1.1.1 y todos sus guardrails PT409.
4. El catálogo TTS vigente al release es V061: TTS_001–089, 89 de 274 temas.
5. `public.tts_topic_catalog` queda como fuente autoritativa online de disponibilidad TTS.
6. El catálogo es solo lectura para `authenticated`: SELECT permitido; escritura, truncado, referencias y triggers denegados; 1 política SELECT y 0 políticas de escritura.

## Comportamiento de la webapp

1. La app carga primero un respaldo local V061 con 274 temas y 89 disponibles.
2. Después de autenticar, consulta una sola vez `tts_topic_catalog`.
3. No realiza consultas por fila ni al abrir, ordenar o agrupar Cobertura canónica.
4. Si Supabase falla o responde vacío, conserva el respaldo local.
5. **Tu mapa actual de debilidades** y **Mi Estado → Cobertura canónica** consumen el mismo mapa local por `rentability_topic_id`.
6. Cobertura canónica muestra una columna TTS y la vista agrupada informa cuántos TTS existen por especialidad.
7. El detalle de tema muestra el estado TTS y permite copiar un pedido de suplemento o creación.
8. La webapp no puede insertar, actualizar ni eliminar registros TTS.

## Continuidad

Las futuras lecturas pueden incorporarse administrativamente a `tts_topic_catalog`; aparecerán en la webapp después de recargar sin requerir una nueva versión frontend. El respaldo local debe actualizarse en releases posteriores cuando se quiera equivalencia offline con el catálogo online.
