# Residentado v0.5 — Plan 75+/80

Esta versión consolida en una sola actualización:

- meta 75+/80;
- examen: 6 de septiembre de 2026;
- fecha objetivo de estar listo: 23 de agosto;
- viajes 25–29 de julio y 8–15 de agosto;
- plan diario automático y exigente;
- deuda de estudio;
- checklist diaria;
- hoja de ruta y prelectura;
- práctica rápida y Sprints 10/15/30;
- repaso adaptativo según acierto, tiempo y estabilidad estimada;
- objetivo de velocidad: 25 s por pregunta;
- sesiones personalizadas;
- simulacros persistentes entre dispositivos.

## Orden de actualización

### 1. Supabase

En SQL Editor ejecuta **todo** `supabase_migration_v0_5.sql`.

Esta migración está hecha para tu estado actual: ya tienes las tablas `questions` y `attempts`, pero todavía no ejecutaste v0.4.

### 2. GitHub

Después de que Supabase muestre `Success`, reemplaza en el repositorio los archivos de la app por los de `residentado_v0_5_update.zip`.

Los principales son:

- `app.js`
- `styles.css`
- `service-worker.js`
- `pilot-data.js`
- `index.html`
- `manifest.webmanifest`

Conserva `config.js` de este paquete: ya está conectado a tu proyecto Supabase.

### 3. Recarga forzada

Tras el despliegue de GitHub Pages:

- Windows: `Ctrl + F5`.
- Android: cierra la pestaña/app y vuelve a abrirla. Si la versión antigua persiste, borra los datos del sitio o desinstala/reinstala la PWA.

## Nota del algoritmo de repaso

La v0.5 usa un programador adaptativo basado en tres estados conceptuales: dificultad, estabilidad y probabilidad estimada de recuerdo. No pretende ser una implementación oficial de FSRS. Ajusta el próximo repaso usando:

- correcta/incorrecta;
- tiempo de respuesta;
- objetivo absoluto de 25 s;
- historial individual de la pregunta;
- riesgo de olvido estimado;
- fase del plan hasta el examen.

El banco completo añadirá rentabilidad histórica real por tema y agrupación por concepto.
