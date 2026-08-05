# Residentado v1.2.0 — notas de aprendizaje y navegación de revisión

## Base y alcance

Este release parte exclusivamente de **Residentado v1.1.1** y conserva sus correcciones de concurrencia, recuperación y persistencia de sesiones. No deriva de v1.1.0-rc3.

No modifica el corpus clínico, las 2.180 preguntas, la taxonomía de 274 temas, los intentos, la memoria adaptativa ni la rentabilidad.

## Mejoras incorporadas

### Cobertura canónica

- La tabla de temas en **Mi estado → Cobertura canónica** tiene columna `N.º`.
- La numeración corresponde al orden visible.
- En la vista agrupada, la numeración empieza nuevamente dentro de cada especialidad.
- Mi Estado sigue calculándose localmente, sin consultas nuevas al abrir la vista.

### Revisión de respondidas

- Campo `Ir a` para saltar a una posición concreta.
- Botón `Última`.
- Botón `Salir` disponible desde cualquier pregunta intermedia.
- En sesiones parciales se muestra la posición dentro de las respondidas y la posición original en la sesión completa.
- Salir de una revisión histórica vuelve al historial; salir de una revisión recién terminada vuelve al inicio.

### Notas personales de aprendizaje

- Tabla y flujo separados de `question_review_flags`.
- Una nota expresa un vacío personal; no afirma que la pregunta esté mal.
- Tipos: duda general, fármaco/mecanismo, valor/dosis/corte, diferencial, explicación no comprendida y otro dato.
- Edición, cierre, descarte e historial trazable.
- Exportación Markdown y CSV con:
  - duda y `note_id`;
  - pregunta, alternativas y clave histórica;
  - criterio auditado y explicación disponibles;
  - taxonomía canónica y rentabilidad;
  - cobertura personal e historial de intentos;
  - existencia de un flag de auditoría paralelo;
  - protocolo Anki vigente y estrategia preliminar de posición.

## Flujo Anki previsto

Cada nota debe resolverse como una de estas decisiones:

- `ALREADY_COVERED`;
- `UPDATE_EXISTING_CARD`;
- `CREATE_NEW_CARD`;
- `RESOLVED_WITHOUT_ANKI`.

La exportación ordena el trabajo por **MUY ALTA → ALTA → MEDIA → BAJA** y puntaje descendente. Si el tema ya fue iniciado, una tarjeta realmente nueva debe quedar entre las primeras nuevas pendientes de su mazo/tier. Colocarla cerca de tarjetas conceptualmente relacionadas solo se hará cuando un `.colpkg` actualizado permita verificar y modificar el orden sin dañar GUID, programación o historial.

Las instrucciones Anki vigentes del Contexto Maestro siempre prevalecen sobre el texto exportado por una versión anterior de la app.

## Migración de Supabase

Ejecutar:

`MIGRATIONS/20260805_ADD_QUESTION_LEARNING_NOTES_V1_2_0.sql`

La migración es idempotente y:

- crea `public.question_learning_notes`;
- permite una sola nota `OPEN` por usuario/pregunta;
- conserva cierres históricos ilimitados;
- aplica Row Level Security por usuario;
- no toca sesiones, intentos, memoria, preguntas ni flags.

Después puede ejecutarse `QA/VERIFY_SUPABASE_V1_2_0.sql`.

## Publicación segura

1. Respaldar el despliegue v1.1.1.
2. No borrar almacenamiento local ni IndexedDB.
3. Aplicar la migración de notas.
4. Publicar todos los archivos.
5. Recargar y verificar `v1.2.0`.
6. Ejecutar el smoke real descrito en `QA_V1_2_0.md`.

## QA automatizado

```bash
python3 QA/qa_v1_2_0.py
python3 QA/qa_browser_v1_2_0.py
```

El segundo comando requiere Python Playwright y Chromium; el primero no depende del navegador.
