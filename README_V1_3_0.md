# Residentado v1.3.0 — catálogo TTS en Debilidades y Cobertura canónica

## Base y alcance

Este release parte de **Residentado v1.2.0** y conserva íntegramente:

- PT409/HTTP 409 para conflictos funcionales de sesión;
- recuperación antes de descartar estado local;
- lease entre pestañas;
- validación de `state_revision` al cerrar;
- notas personales separadas de flags;
- navegación de revisión;
- numeración de Cobertura canónica;
- cálculo local de Mi Estado.

No modifica las 2.180 preguntas, taxonomía, rentabilidad, claves históricas, explicaciones, intentos, memoria, sesiones, flags ni notas.

## Integración TTS

La fuente autoritativa online es:

`public.tts_topic_catalog`

La tabla fue creada y cargada previamente con TTS_001–089 y quedó protegida como solo lectura para `authenticated`.

La aplicación sigue esta secuencia:

1. carga `tts_catalog.json` como respaldo local;
2. después de autenticar al usuario, realiza una sola consulta `SELECT` a `tts_topic_catalog`;
3. normaliza el formato Supabase y reemplaza el respaldo únicamente si recibe filas válidas;
4. conserva el respaldo si hay error de red, permisos, tabla ausente o respuesta vacía;
5. comparte el mismo `Map` local entre Debilidades, Cobertura canónica y el detalle de tema.

No existe polling y no se consulta Supabase por tema, fila, ordenamiento o cambio de vista.

## Cambios visibles

### Tu mapa actual de debilidades

- La columna TTS usa el catálogo V061 actualizado.
- Los temas disponibles muestran código y estado, por ejemplo `TTS_089 · Completa · 7 partes`.
- Los temas sin lectura muestran `Pendiente`.
- El encabezado declara número de TTS, versión del catálogo y fuente utilizada.
- El botón continúa copiando un pedido de suplemento cuando la lectura ya existe o un pedido de TTS cuando está pendiente.

### Mi Estado → Cobertura canónica

- Nueva columna `TTS` en la vista de temas.
- La vista agrupada conserva la columna dentro de cada especialidad.
- El resumen de cada especialidad muestra `TTS disponibles/temas`.
- El detalle del tema muestra el estado TTS y permite copiar el pedido correspondiente.
- El bloque declara catálogo, cantidad disponible y si se usó Supabase o el respaldo local.

## Respaldo local

`tts_catalog.json` contiene los 274 temas:

- 89 en estado `COMPLETE` — TTS_001–089;
- 185 en estado `PENDING`.

Este respaldo permite que la disponibilidad siga visible sin conexión. Las futuras altas en Supabase aparecerán online después de recargar, sin exigir una nueva versión de la webapp. El respaldo local puede actualizarse en un release posterior para mejorar la experiencia offline.

## Supabase

No hay migración pendiente para publicar v1.3.0. Se incluyen por trazabilidad:

- `MIGRATIONS/20260805_ADD_TTS_TOPIC_CATALOG_V061.sql`;
- `MIGRATIONS/20260805_FIX_TTS_TOPIC_CATALOG_READONLY_C1.sql`;
- verificadores asociados.

No volver a ejecutarlos salvo necesidad documentada; son idempotentes o correctivos, pero el estado ya fue validado.

## QA

```bash
python3 QA/qa_v1_3_0.py
python3 QA/qa_browser_v1_3_0.py
```

Resultados de la entrega:

- sintaxis JavaScript: PASS;
- guardrails v1.1.1: PASS;
- funciones v1.2.0: PASS;
- catálogo estático 274/89: PASS;
- normalización Supabase snake_case: PASS;
- Cobertura canónica con TTS: PASS;
- Debilidades con TTS: PASS;
- vista por especialidad: PASS;
- smoke headless: PASS.
