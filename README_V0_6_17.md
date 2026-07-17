# Residentado — v0.6.17

## Cambio principal

Se añadió un sistema persistente y personal de flags para auditar preguntas sin alterar respuestas, intentos, prioridad ni memoria adaptativa.

Después de responder o durante la revisión puedes marcar una pregunta como:

- **Revisar enunciado**: redacción, datos clínicos, alternativas o ambigüedad.
- **Revisar explicación**: explicación insuficiente, confusa, desactualizada o tautológica.
- **Revisar**: observación general.

Cada pregunta conserva un solo motivo activo. Se puede cambiar o quitar.

## Lista para compartir

En el menú `⋮` aparece **Preguntas para revisar**. Desde allí puedes:

- filtrar por tipo;
- copiar una lista lista para pegar en el chat;
- descargar un archivo CSV;
- quitar flags ya resueltos.

La lista incluye identificador, año/prueba/número, taxonomía y enunciado.

## Instalación requerida

Antes de usar esta versión en Supabase, ejecuta una sola vez:

`supabase_migration_v0_6_17_review_flags.sql`

La migración crea `public.question_review_flags` con Row Level Security (RLS), es decir, seguridad por filas: cada usuario solo puede leer y modificar sus propias marcas.

## Compatibilidad

- Conserva taxonomía global V2/V2.1.
- Conserva metadatos protegidos antes de responder.
- No cambia preguntas, claves, explicaciones, intentos ni memoria adaptativa.
- En modo local sin Supabase, los flags se guardan en `localStorage`.
