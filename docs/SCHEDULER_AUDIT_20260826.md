# Auditoría del scheduler preexamen — 2026-08-26

## Evidencia operativa utilizada

Snapshots exportados de producción el 26/08/2026:

- `260826_1134_Public_attempts.csv`: 3.455 attempts.
- `260826_1135_Question_Memory_State.csv`: 1.084 estados de memoria.
- `260826_1135_Practice_Sessions.csv`: 98 sesiones.
- Banco/taxonomía: `260818_questions_01.csv` y `260818_rentability_topics_01.csv`.

## Hallazgos que motivan v1.5.1

Corpus válido/no observado usado por el scheduler: 1.899 preguntas.

| Tier | Válidas | Vistas | Sin primera exposición |
|---|---:|---:|---:|
| MUY_ALTA | 476 | 476 | 0 |
| ALTA | 635 | 338 | 297 |
| MEDIA | 648 | 180 | 468 |
| BAJA | 140 | 22 | 118 |
| Total | 1.899 | 1.016 | 883 |

Al corte de 26/08 11:35 America/Lima:

- 564 preguntas válidas estaban vencidas por `due_at`.
- 448 vencidas eran MUY_ALTA/ALTA.
- Existían preguntas MUY_ALTA/ALTA vencidas desde 9–10 de agosto y con última exposición a fines de julio/inicios de agosto.
- La auditoría previa de sesiones mostró que preguntas de alta rentabilidad antiguamente vencidas podían no llegar a las primeras posiciones de sesiones parciales, mientras otras preguntas reaparecían repetidamente en colas recientes.

## Política v1.5.1

1. La fórmula de memoria no cambia: se preservan estabilidad, dificultad, estimación de recuerdo, retención objetivo y `due_at`.
2. La fase de cobertura deja de terminar por una fecha única examen-10.
3. MUY_ALTA/ALTA sin ver siguen elegibles hasta examen-3 y se intenta cerrar su primera vuelta alrededor de examen-9.
4. MEDIA rentable se mantiene como cobertura intensiva hasta examen-5 una vez cerrada MUY_ALTA/ALTA.
5. Nuevas durante rescate: máximo 120/día.
6. Vencidas durante rescate: máximo 140/día.
7. Anti-starvation: la cola `due` intercala aproximadamente una posición de MUY_ALTA/ALTA antiguamente vencida por cada posición proveniente de la prioridad adaptativa general, con deduplicación.
8. BAJA no prolonga la fase intensiva.

## Resultado esperado con el snapshot del 26/08

Con 297 ALTA sin primera exposición y objetivo relativo examen-9 = 28/08:

- objetivo de nuevas hoy: **99**;
- objetivo de vencidas hoy: **140**;
- bloque máximo de errores/dudas: 25 (pool observado: 158);
- bloque máximo de velocidad: 20 (pool observado: 324);
- máximo teórico planificado antes de descontar solapamientos del día: 284 respuestas.

El algoritmo filtra preguntas ya contestadas ese día al abrir cada tarea, por lo que los solapamientos entre vencidas, frágiles y velocidad no deberían materializarse como repetición intradía automática.

## Base educativa

- Maye JA, Hurley F. *The Effectiveness of Spaced Repetition in Medical Education: A Systematic Review and Meta-Analysis*. Clin Teach. 2026;23(2):e70353. PMID 41601436. Meta-análisis: 21.415 estudiantes, SMD 0,78 (IC95% 0,56–0,99) a favor de repetición espaciada.
- Systematic review of distributed practice and retrieval practice in health professions education. PMID 37615780. 43 de 63 experimentos mostraron beneficio significativo.
- Brunmair M, Richter T. *Similarity matters: A meta-analysis of interleaved learning and its moderators*. Psychol Bull. PMID 31556629. Efecto global moderado (g 0,42), especialmente útil cuando las categorías a discriminar son similares.
- Manual oficial de Anki, Deck Options/FSRS: mayor `desired retention` acorta intervalos y eleva rápidamente la carga; recomienda cautela por encima de 0,90 y mantenerla por debajo de 0,97. `Reschedule Cards on Change` puede crear un gran backlog inmediato y debe usarse con moderación.

## Interpretación

La WebApp no implementa FSRS oficial. Usa un modelo propio de estabilidad/recuerdo con forma `R = 0.9^(t/S)` y actualización heurística de estabilidad/dificultad. v1.5.1 no intenta sustituirlo a pocos días del examen: utiliza ese modelo como señal de riesgo de olvido y corrige la política de selección para incorporar rentabilidad, cobertura pendiente y edad del vencimiento.
