# Residentado — v0.6.15

## Compatibilidad con la taxonomía global V2

Esta versión puede instalarse antes o después de la migración de Supabase.

### Antes de migrar

- Usa `area`, `specialty`, `topic` y `subtopic`.
- Mantiene el cálculo provisional de rentabilidad por corpus.
- No cambia sesiones, intentos ni memoria.

### Después de migrar

La app detecta automáticamente y prioriza:

- `canonical_area`
- `canonical_specialty`
- `rentability_topic_label`
- `canonical_entity`
- `exam_rentability_score`

La navegación queda:

**Área canónica → Especialidad canónica → Tema de rentabilidad**

La entidad clínica aparece como etiqueta fina durante la práctica y revisión.

## Rentabilidad y prioridad personal

- Rentabilidad del examen: procede del corpus auditado y usa un puntaje de 0 a 100.
- Prioridad personal: continúa calculándose con errores, dudas, lentitud,
  repasos vencidos y cobertura.

Ambas permanecen separadas.

## Seguridad

- No requiere migración para abrir la app.
- No contiene credenciales nuevas.
- No modifica Supabase por sí sola.
- Conserva compatibilidad con la estructura histórica.
