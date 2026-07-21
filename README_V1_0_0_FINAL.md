# Residentado v1.0.0 — versión funcional final

**Fecha:** 21 de julio de 2026  
**Base compatible:** banco canónico V0721, taxonomía V2.5, 2.180 preguntas y 274 temas.

Esta versión cierra la **Fase B** de la hoja de ruta. La aplicación queda congelada funcionalmente para que las mejoras posteriores se concentren en:

- auditoría integral del banco;
- parches periódicos de contenido y taxonomía;
- generación prioritaria de tarjetas Anki;
- incorporación futura de nuevos exámenes.

## Cambios incluidos

### 1. Referencia rápida

- Se muestra después de la explicación principal.
- Permanece cerrada por defecto.
- Solo aparece cuando existe contenido útil.
- Reúne comparaciones, criterios, escalas, valores, dosis, abreviaturas, epónimos y términos.
- La lógica rápida, la explicación de la clave, los distractores, la trampa y la perla siguen visibles fuera de este bloque.

### 2. Fármacos y antibióticos

La app deriva una presentación estructurada desde los campos ya existentes, sin añadir columnas a `questions`.

Cuando corresponde, organiza la comparación disponible en:

- clase;
- mecanismo y diana;
- espectro o cobertura;
- indicación;
- toxicidad o reacción adversa;
- contraindicación o precaución;
- antídoto o reversión;
- diferencias clave.

La auditoría farmacológica total sigue pendiente: esta función organiza lo que ya está escrito, pero no inventa información ausente.

### 3. Ocultamiento de contenido vacío

- No se renderizan alternativas vacías o con espacios.
- No se muestran tarjetas sin explicación real.
- Se eliminan líneas editoriales como `No requiere siglas`, `No hay siglas indispensables` y variantes equivalentes.
- Si una línea vacía precede a un epónimo o término útil, se elimina solo la línea vacía y se conserva el contenido real.

### 4. Trazabilidad de observaciones

Los flags ya no tienen que borrarse para desaparecer de la cola activa.

Estados:

- `OPEN`: pendiente de revisión;
- `RESOLVED`: corregida mediante un parche identificado;
- `DISMISSED`: retirada sin parche.

Al registrar un parche se conserva:

- pregunta;
- tipo de observación;
- revisión del contenido al momento de marcar;
- fecha de creación y cierre;
- identificador del parche;
- resumen de la resolución;
- vínculo con una observación anterior de la misma pregunta.

Si la pregunta vuelve a marcarse, se crea un nuevo registro enlazado y vuelve a la cola activa.

## Instalación sobre v0.6.18

1. Respaldar el repositorio y Supabase.
2. Ejecutar en Supabase:

```text
supabase_migration_v1_0_0_review_history.sql
```

3. Reemplazar los archivos de la aplicación por los de este paquete.
4. Conservar `config.js` con la configuración vigente del proyecto.
5. Publicar o hacer merge en GitHub.
6. Recargar dos veces la webapp. Si está instalada como aplicación web progresiva, cerrarla y abrirla nuevamente para activar el caché `residentado-v1-0-0`.

No es necesario volver a ejecutar:

- lotes médicos 1–6;
- reconciliación V2.5;
- migración de imágenes v0.6.18;
- migración inicial de flags v0.6.17, si ya está instalada.

## Flujo posterior recomendado

```text
flags OPEN
→ auditoría contra PDF oficial y fuentes vigentes
→ parche transaccional de questions/rentability_topics
→ registrar patch_id y resolución
→ flags RESOLVED
→ candidatos Anki priorizados
```

La aplicación no modifica automáticamente intentos, memoria, sesiones ni estados canónicos `OBSERVADA_*`.
