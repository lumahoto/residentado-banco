# HANDOFF — Residentado v1.3.0

## Checkpoint

- Versión: `1.3.0`.
- Base: `260805_residentado-banco-main.zip` — Residentado v1.2.0.
- Cambio principal: catálogo TTS Supabase compartido por Debilidades y Cobertura canónica.
- Catálogo vigente al cierre: V061, TTS_001–089, 89/274 temas.

## Estado Supabase ya aplicado

`public.tts_topic_catalog`:

- 89 filas;
- 89 temas distintos;
- TTS_001–089;
- `topic_ids_sin_correspondencia = 0`;
- RLS activo;
- `authenticated` puede seleccionar y no puede escribir;
- 1 política de lectura, 0 de escritura;
- control de solo lectura `PASS`.

## Arquitectura runtime

- `loadStaticTtsCatalog()` carga el respaldo V061.
- `loadCloudTtsCatalog()` ejecuta un único `SELECT` después de autenticación.
- `applyTtsCatalog()` genera un mapa por `rentability_topic_id`.
- `w4-data.js` normaliza camelCase y snake_case.
- `renderWeaknessReport()` y `renderStats()` consumen el mismo mapa local.
- `renderStats()` no llama Supabase.
- Una respuesta remota vacía no reemplaza un respaldo válido.

## Futuras incorporaciones TTS

Para TTS_090 y posteriores:

1. insertar/actualizar el registro correspondiente mediante un paquete administrativo trazable;
2. preservar permisos de solo lectura para `authenticated`;
3. verificar correspondencia con `questions.rentability_topic_id`;
4. recargar la webapp: la nueva disponibilidad aparecerá sin modificar el frontend;
5. actualizar `tts_catalog.json` en una entrega posterior si se quiere respaldo offline al mismo nivel.

No escribir desde la webapp en `tts_topic_catalog`.

## Archivos runtime modificados

- `app.js`;
- `w4-data.js`;
- `tts_catalog.json`;
- `styles.css`;
- `version.js`;
- `service-worker.js`.

## Archivos críticos preservados

- `session-core.js`;
- `session-storage.js`;
- `config.js`;
- `question-parser.js`;
- `w3-tools.js`;
- `pilot-data.js`.

## Pruebas posteriores al despliegue

1. Confirmar `v1.3.0`.
2. Confirmar `residentado-v1-3-0` en la PWA.
3. Abrir Mi Estado y verificar `Catálogo V061 · 89 TTS disponibles · fuente Supabase`.
4. Cambiar entre temas y especialidades sin nuevas consultas por fila.
5. Abrir Debilidades y confirmar códigos TTS correctos.
6. Probar un botón TTS disponible y uno pendiente.
7. Confirmar que notas, revisión y sesiones siguen funcionando.
8. Observar logs y confirmar ausencia de `40001` y de escrituras a `tts_topic_catalog`.
