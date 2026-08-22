# Aplicación y smoke test — Residentado v1.5.0

## 1. Antes de publicar

1. Confirmar que el repositorio actual corresponde a v1.4.3 R2.
2. Ejecutar en Supabase `MIGRATIONS/20260822_REVIEW_CENTER_ANKI_SCOPE_V1_5_0.sql`.
3. Ejecutar los tres QA del repositorio.
4. Publicar el contenido del build v1.5.0 en GitHub.

No modificar ni volver a ejecutar la migración de Taxonomía V3 A16.

## 2. Verificación SQL mínima

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'question_review_flags'
  and column_name = 'learning_scope';

select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid in (
  'public.question_review_flags'::regclass,
  'public.question_learning_notes'::regclass
)
and conname in (
  'question_review_flags_learning_scope_check',
  'question_learning_notes_anki_action_check'
);
```

Esperado: `learning_scope` existe y el `CHECK` de `anki_action` incluye `REEXPOSE_EXISTING_CARD`.

## 3. Smoke funcional

### A. `?` a nivel de pregunta

1. Abrir una práctica ordinaria.
2. Confirmar que no hay un `?` junto a cada alternativa.
3. Marcar `?` arriba de la pregunta.
4. Responder y abrir la explicación.
5. Confirmar que abajo aparece la misma duda marcada.
6. Desmarcar abajo y confirmar que arriba queda desmarcada.
7. Confirmar que no se creó Nota ni flag de revisión por usar `?`.

### B. Centro de revisión

1. Completar o cerrar parcialmente una sesión con varias respuestas.
2. Entrar en `Revisar respuestas`.
3. Confirmar que aparece primero el resumen/hoja informativa.
4. Verificar número original, estado, Tema y Entidad cuando exista.
5. Probar `Incorrectas`, `No sé`, `? Duda`, `Notas`, `Marcadas`, `Revisar` y `Auditoría`.
6. Entrar a un filtro y confirmar que Anterior/Siguiente recorre solo ese subconjunto.
7. Confirmar que la posición original de la pregunta sigue visible.
8. Abrir la misma sesión desde `Historial` y confirmar que usa el mismo Centro de revisión.

### C. Nota / Revisar pregunta → Anki

1. Crear una Nota de contenido.
2. Confirmar que al registrar su resolución solo aparecen: crear, actualizar o reexponer tarjeta.
3. En `Revisar pregunta`, elegir `Contenido / duda` y guardar.
4. Confirmar que existe también una Nota de aprendizaje abierta para esa pregunta.
5. Repetir con `Editorial / técnico` y confirmar que no crea Nota automáticamente.

### D. Cambio de día — guardrail de integridad

La validación real puede hacerse con una sesión creada el día anterior o ajustando únicamente un entorno de prueba.

1. Dejar una sesión con respuestas mediante `Continuar después`.
2. Al día siguiente abrir/reanudar la app.
3. Confirmar que la sesión ya no aparece como reanudable y sí aparece como cierre parcial en Historial.
4. Confirmar que solo se revisan las preguntas respondidas.
5. Verificar que el autocierre produjo **0 attempts nuevos**.
6. Repetir con una sesión sin respuestas y confirmar que no aparece como sesión útil del Historial.

## 4. Regresión PT409 obligatoria

Mantener estas pruebas de v1.4.3 R2:

- recovery con 30 respuestas heredadas + cerrar sin responder nada → **0 attempts nuevos** y **0 cambios de memoria**;
- misma recovery + 2 respuestas realmente nuevas → **exactamente 2 attempts nuevos**;
- ningún `client_attempt_id` histórico cambia de `session_id` por cerrar una recovery.

## 5. Cierre

Si todos los smoke pasan, marcar el release como desplegado y actualizar el Estado Operativo/Sources con la versión efectivamente publicada.
