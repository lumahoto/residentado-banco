# Residentado — v0.6.10

## Corrección final: Alta rentabilidad

La v0.6.8/v0.6.9 podía dejar deshabilitado el filtro `Alta rentabilidad` porque exigía que el nombre exacto del tema se repitiera varias veces. La taxonomía editorial del banco es deliberadamente granular, por lo que muchos temas exactos son únicos aunque pertenezcan a áreas y especialidades muy recurrentes.

### Nuevo cálculo

La webapp estima la rentabilidad histórica combinando:

- recurrencia del tema;
- frecuencia y presencia entre años de la especialidad;
- frecuencia y presencia entre años del área.

Se selecciona aproximadamente el 30% superior del corpus cargado, preservando cualquier clasificación explícita de alta rentabilidad que se incorpore en el futuro.

La clasificación:

- se recalcula al cargar el corpus;
- no depende del número de preguntas respondidas por el usuario;
- se actualiza automáticamente al importar más años;
- es provisional hasta la auditoría final del corpus completo de 2.180 preguntas.

## Compatibilidad

- No requiere migración SQL.
- Conserva todas las funciones de v0.6.9.
- Versión visible en la interfaz: `v0.6.10`.
