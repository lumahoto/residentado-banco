# Decision log v1.5.2 — 2026-08-26

## Hallazgo de auditoría
`targetRetention` cambia por fecha, pero `due_at` se calculó cuando ocurrió la última respuesta. Al elevar la retención objetivo, algunas preguntas pueden quedar por debajo del objetivo vigente sin que su `due_at` haya llegado todavía.

Snapshot real 26/08: 19 preguntas MUY_ALTA/ALTA estaban por debajo de 0,93 sin estar vencidas por `due_at`; 2 tenían `due_at` posterior al examen.

## Decisión
No reescribir memoria ni fechas persistidas. Considerar una pregunta elegible para repaso cuando `due_at <= now` **o** `estimateRecall(state, now) < targetRetention(today, q)`.

Esto alinea selección y objetivo de retención con el mínimo riesgo operativo.

## Validación contra snapshot 26/08 12:26 Lima

- vencidas estrictas por `due_at`: 564;
- elegibles tras alinear con retención vigente: 583;
- incremento: 19;
- las 19 adicionales son 8 MUY_ALTA y 11 ALTA;
- elegibles MUY_ALTA/ALTA: 467 frente a 448 estrictamente vencidas;
- el tope del bloque continúa en 140, por lo que no aumenta la carga diaria: mejora la composición de la cola.
