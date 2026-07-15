# Residentado app v0.6.2

## Cambios principales

### Cancelar / salir
- Simulacro estándar: salir y continuar después o cancelar.
- Simulacro histórico: salir y continuar después o cancelar.
- Descanso entre bloques: también permite salir o cancelar.
- Dashboard: muestra todas las sesiones activas, cada una con Reanudar y Cancelar.
- Práctica: botón Cancelar sesión.

### Regla al cancelar práctica
- Corrección inmediata: los intentos ya respondidos se conservan; el resto de la cola se descarta.
- Corrección al final: cancelar descarta la sesión no entregada y no crea intentos.

### Duda `?`
- Las alternativas dejadas con `?` se guardan en el intento.
- Una respuesta correcta con `?` recibe una calificación de memoria menor y vuelve antes al repaso.
- La pregunta gana prioridad personal.
- En la revisión se destacan exactamente las alternativas que quedaron dudosas y se muestra su explicación.
- El puntaje del simulacro NO cambia: una respuesta correcta sigue siendo correcta.

### Robustez adicional
- Las preguntas en blanco de sesiones con corrección al final ya no cuentan como intentos.
- En la hoja de respuestas, tocar de nuevo la misma burbuja borra esa respuesta.
- El simulacro histórico permite marcar toda una pregunta para revisar.
- El resumen final muestra respondidas, sin responder, marcadas y dudosas.
- Corregido el retorno desde el resumen de un histórico: vuelve al cuadernillo histórico, no a la vista estándar.
- Todas las sesiones activas quedan visibles para evitar sesiones olvidadas.

## SQL
Ejecuta `supabase_migration_v0_6_2.sql`.
Incluye la limpieza del bug v0.6.1, por lo que no necesitas ejecutar por separado el SQL de limpieza anterior.
