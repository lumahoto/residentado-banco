# Residentado — actualización v0.6.6

Base: v0.6.5.

No requiere nueva migración SQL ni cambios de esquema en Supabase.

## Cambios

### 1. Botón “No sé”
En práctica sin límite de tiempo aparece:

`🤷 No sé · mostrar respuesta`

- Registra una respuesta incorrecta explícita.
- No cuenta como pregunta en blanco.
- Evita elegir una alternativa al azar solo para avanzar.
- En corrección inmediata muestra la explicación.
- En corrección al final queda registrada como “No sé” y se contabiliza como incorrecta.

La identificación usa los campos existentes:
- `selected_answer = null`
- `is_correct = false`
- `timed_out = false`
- `speed_bucket = dont_know`
- `uncertainty_note = NO_SE_EXPLICITO`

No se añade ninguna columna nueva.

### 2. Objetivo de tiempo adaptable por pregunta
El objetivo ya no es idéntico para todas las preguntas. La heurística usa la carga de lectura y aplica una guardia para preguntas cortas que impliquen cálculo, dosis, puntuaciones o clasificaciones.

Con una base de 25 segundos:
- carga de lectura muy corta: 15 s
- corta: 20 s
- estándar: 25 s
- larga: 30 s
- muy larga: 35 s

La carga se estima con el texto del enunciado y las alternativas. La base sigue siendo configurable; los escalones se escalan proporcionalmente.

El objetivo adaptable:
- se muestra durante práctica sin límite;
- ajusta el cronómetro del modo “por pregunta”;
- se guarda en `target_seconds`;
- se usa para velocidad, fluidez, memoria y prioridad.

### 3. Alineación de “Orden aleatorio”
Se corrige la alineación del checkbox y el texto en el constructor de sesiones.

### Compatibilidad
- Compatible con la migración v0.6.2 ya aplicada.
- No modifica las tablas.
- Construida sobre v0.6.5.
