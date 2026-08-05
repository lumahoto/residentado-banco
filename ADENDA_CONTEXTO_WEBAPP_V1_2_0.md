# Adenda de precedencia — Webapp Residentado v1.2.0

Esta adenda reemplaza cualquier referencia que considere v1.0.0, v1.1.0-rc2, v1.1.0-rc3 o v1.1.1 como versión funcional vigente de la webapp.

## Versión vigente

- Aplicación: Residentado v1.2.0.
- Base técnica: v1.1.1.
- Fuente única de versión/caché: `version.js`.
- Caché: `residentado-v1-2-0`.
- Corpus y taxonomía: sin cambios; siguen vigentes las fuentes canónicas post segunda auditoría del 4 de agosto de 2026.

## Nuevas reglas

- Las notas personales de aprendizaje no son flags de auditoría.
- Se almacenan en `question_learning_notes` y pueden coexistir con un flag sobre la misma pregunta.
- Su objetivo es exportar vacíos personales, resolverlos y deduplicarlos contra la exportación Anki más reciente.
- No toda nota produce tarjeta.
- Las tarjetas nuevas se ordenan por rentabilidad y prioridad personal; si el tema ya fue iniciado, se priorizan entre las primeras nuevas del tier. La colocación junto a tarjetas relacionadas requiere `.colpkg` actualizado y verificación segura.
- Las tarjetas existentes conservan GUID, programación e historial.
- Mi Estado continúa calculándose localmente.

## Precedencia técnica

Las correcciones de v1.1.1 sobre PT409, recuperación de sesiones, lease entre pestañas, cierre optimista, outbox y caché no pueden eliminarse al continuar el desarrollo.
