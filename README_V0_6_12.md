# Residentado — v0.6.12

## Corrección: tiempo por pregunta + corrección al final

Esta versión corrige el reinicio indebido del cronómetro al volver a una pregunta anterior.

### Reglas de sesión

- **Práctica con tiempo por pregunta y corrección al final:** el tiempo consumido se conserva por pregunta entre visitas.
- Si el tiempo llega a cero **sin respuesta**, la pregunta queda cerrada, se registra al finalizar la sesión como **un único intento incorrecto por tiempo** (`timed_out = true`) y no puede responderse después.
- Si el tiempo llega a cero **después de haber elegido una respuesta**, se conserva esa respuesta y la pregunta queda cerrada; ya no puede modificarse.
- Volver atrás **no reinicia el reloj** y **no crea intentos adicionales**.
- Antes de que una pregunta quede cerrada, cambiar de alternativa en una sesión con corrección al final reemplaza la respuesta provisional. Al entregar, se guarda **un solo intento**, correspondiente a la respuesta final.
- Las preguntas dejadas voluntariamente en blanco y que no agotaron su tiempo siguen sin crear intentos de aprendizaje, según la política previa.
- En prácticas con **tiempo total** o **sin límite**, la corrección al final mantiene el comportamiento de respuesta editable hasta la entrega.

No requiere cambios SQL.
