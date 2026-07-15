# Residentado v0.6.5

Actualización consolidada sobre **v0.6.4**.

## No requiere nueva migración SQL

Esta versión reutiliza los campos ya creados en la migración v0.6.2:

- `was_uncertain`
- `uncertain_options`
- `uncertainty_note`

La política existente de actualización de intentos permite convertir un intento ya guardado en un intento con incertidumbre posterior a la corrección.

## Cambios

### 1. Diversificación por año sin romper la prioridad

Las colas de:

- preguntas nuevas;
- prioridad personal;
- errores;
- dudas;
- alta rentabilidad;

mezclan años cuando las preguntas tienen una prioridad suficientemente parecida.

Los repasos vencidos también pueden alternar años, pero **solo entre preguntas que ya están vencidas** y con prioridad muy similar. Nunca se introduce una pregunta no vencida únicamente para diversificar.

### 2. Tiempo visible después de responder

En la corrección inmediata se muestra el tiempo real empleado y el objetivo configurado, por ejemplo:

`⏱ 31 s · objetivo 25 s · el algoritmo registró la lentitud`

El tiempo ya se registraba en v0.6.4; ahora también es visible para el usuario.

### 3. Marcar duda después de ver la corrección

Después de responder aparece:

`❓ No dominaba el razonamiento`

Al pulsarlo:

- el intento se conserva como correcto o incorrecto según la respuesta real;
- `was_uncertain` pasa a `true`;
- se añade `POST_ANSWER_REASONING_MISMATCH` a `uncertainty_note`;
- la memoria de esa pregunta se reconstruye con todos sus intentos;
- la prioridad y el próximo repaso se recalculan.

También está disponible durante la revisión posterior de un simulacro recién entregado.

### 4. Volver arriba al pasar de pregunta

Al renderizar la siguiente pregunta o la siguiente pregunta de revisión, la página vuelve automáticamente al inicio.

### 5. Salir de la cuenta protegido en menú

El botón directo `Salir` fue reemplazado por un menú `⋮`.

Flujo:

1. pulsar `⋮`;
2. pulsar `Salir de la cuenta`;
3. confirmar el cierre de sesión.

Esto reduce cierres accidentales en celular.

### 6. Alta rentabilidad dinámica

Ya no depende de que el usuario responda una cantidad determinada de preguntas.

La app analiza el corpus cargado en cada inicio usando:

- frecuencia del tema;
- recurrencia en distintos años;
- estados explícitos de rentabilidad, cuando existan.

El filtro `Alta rentabilidad` muestra el número de preguntas disponibles y se recalcula automáticamente cuando se importan más años al mismo Supabase.

### 7. Metadatos visuales

Se reemplazó el nombre antiguo:

- `Residentado — Banco piloto`

por:

- `Residentado — Banco 2015–2025`

El caché del service worker se actualizó a `residentado-v0-6-5`.

## Despliegue recomendado

1. Conservar v0.6.4 como respaldo en el historial de Git o en una rama/tag.
2. Sustituir los archivos de la webapp por los de v0.6.5.
3. Hacer commit y push.
4. Abrir la app y recargar una vez para que el nuevo service worker elimine el caché v0.6.4.
5. Probar al menos:
   - una pregunta de repaso prioritario;
   - una respuesta correcta y pulsar `No dominaba el razonamiento`;
   - una respuesta lenta para verificar el indicador de tiempo;
   - `Siguiente pregunta` desde una corrección larga;
   - menú `⋮` y cierre de sesión;
   - filtro `Alta rentabilidad` en práctica personalizada.

Después de verificarlo, v0.6.5 puede convertirse en la nueva base de desarrollo. No conviene borrar el commit/tag de v0.6.4.
