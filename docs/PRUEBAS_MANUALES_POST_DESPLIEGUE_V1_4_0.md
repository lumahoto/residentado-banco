# Pruebas manuales post-despliegue — v1.4.0 / A16

Ejecutar **después** de que `07_POSTCHECK_READONLY.sql` sea correcto.

1. Abrir la WebApp con conexión. Confirmar que muestra `v1.4.0` y no pide recarga forzada para ver la nueva taxonomía.
2. Ir a **Mi Estado**. Confirmar que el primer KPI usa denominador **2.180** y que Cobertura canónica muestra **287 temas activos**.
3. Cambiar Cobertura canónica entre **Temas individuales** y **Agrupado por especialidad**. Confirmar que no se duplica el total de preguntas y que la especialidad no aparece con un tier canónico inventado.
4. Abrir **Practicar → Personalizar práctica**. Confirmar filtros `MUY_ALTA`, `ALTA`, `MEDIA`, `BAJA` y `MUY_ALTA + ALTA`.
5. Elegir un solo topic, crear una sesión corta y comprobar que todas las preguntas pertenecen a ese topic actual.
6. Crear una sesión de 2–3 preguntas, responder una, usar **Continuar después**, volver a abrirla y confirmar la misma posición/progreso.
7. En otra sesión corta, usar **Cerrar sesión parcial y revisar respondidas**. Confirmar cierre y navegación a revisión sin duplicar la sesión.
8. Abrir una sesión histórica existente anterior a V3. Debe abrir por IDs de pregunta; un cambio de label/topic no debe impedir revisar/resumir la sesión.
9. Verificar **Preguntas para revisar** y **Notas de aprendizaje**: una observación/nota previa debe seguir existiendo.
10. Verificar **Historial** y un par de preguntas con intentos previos: los conteos no deben reiniciarse.
11. Cerrar y volver a abrir la app. Debe reutilizar IndexedDB del nuevo `dataset_revision` sin redescargar el corpus cada vez.
12. Opcional: desconectar la red después de una primera carga V3 exitosa y reabrir. El corpus V3 cacheado debe seguir disponible.

## Qué es esperado y no es bug

- que algunos topics cambien de nombre;
- que una pregunta aparezca en otro topic primario;
- que cambie la cobertura porcentual de un topic;
- que cambien tiers/scores según A16;
- que algunos TTS antiguos ya no cuenten como disponibles para un topic deprecado hasta migrar TTS en la fase posterior.

## Señales de bug

- denominador distinto de 2.180 en cobertura del corpus;
- menos o más de 287 topics activos;
- sesión que pierde preguntas por un cambio de topic;
- desaparición de intentos/notas/flags;
- necesidad de recarga forzada para reconocer `dataset_revision` nuevo;
- topic selector que cambia de contenido al renombrar un label aunque conserve el mismo ID;
- mezcla visible de questions V3 con topics V2.
