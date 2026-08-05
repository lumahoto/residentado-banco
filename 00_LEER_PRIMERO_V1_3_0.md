# LEER PRIMERO — Residentado v1.3.0

Esta versión debe publicarse **sobre Residentado v1.2.0**. La base utilizada fue el ZIP actualizado `260805_residentado-banco-main.zip`, no el ZIP antiguo v1.1.1.

## Estado previo confirmado

- `public.tts_topic_catalog`: 89 TTS disponibles, TTS_001–089.
- 89 `rentability_topic_id` con correspondencia canónica.
- RLS activo.
- Rol `authenticated`: `SELECT=true`; `INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER=false`.
- Políticas: 1 de lectura y 0 de escritura.
- Control de solo lectura: `PASS`.

## Publicación

1. Conserva una copia del despliegue v1.2.0.
2. No borres IndexedDB, caché, almacenamiento local, sesiones ni progreso.
3. No necesitas ejecutar otra migración de Supabase: el catálogo y su corrección C1 ya fueron aplicados y verificados.
4. Publica **todos** los archivos de este paquete, incluido `version.js`, `service-worker.js`, `app.js`, `w4-data.js` y `tts_catalog.json`.
5. Recarga dos veces. Si la app está instalada como PWA, ciérrala por completo y vuelve a abrirla.
6. Confirma que la interfaz muestre `v1.3.0`.
7. Abre **Mi Estado → Cobertura canónica** y confirma:
   - columna `TTS`;
   - 89 TTS disponibles;
   - códigos TTS_001–089 donde corresponda;
   - `Pendiente` en los demás temas.
8. Abre **Tu mapa actual de debilidades** y confirma que usa la misma disponibilidad.

## Comportamiento de seguridad

La webapp consulta el catálogo TTS una sola vez al sincronizar la cuenta. Después, ambas vistas trabajan con el mapa local en memoria. No se realizan consultas por fila ni al cambiar el orden o la vista.

Si Supabase no responde o devuelve una tabla vacía por error, se conserva el respaldo local V061 con 274 temas y 89 TTS disponibles.
