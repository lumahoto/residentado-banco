# Residentado — v0.6.13

## Revisión al terminar: explicaciones y duda posterior

- La revisión pregunta por pregunta siempre intenta mostrar la explicación completa, tanto si la respuesta fue correcta como incorrecta, omitida o cerrada por tiempo.
- Se mantiene visible la lógica rápida, comparación, explicación de la clave, distractores, trampa y perla cuando estén disponibles.
- En toda pregunta respondida de la revisión aparece `❓ No dominaba el razonamiento` cuando existe un intento guardado.
- Marcarla conserva el resultado original, pero reclasifica el conocimiento como frágil y adelanta el repaso.
- Se añadió un fallback defensivo: un dato editorial inesperado ya no debe dejar la revisión mostrando solo la alternativa verde sin explicación.
- Los simulacros guardan el mapa exacto de intentos de la sesión para que la duda posterior modifique el intento correcto de esa sesión.
- No requiere migración SQL nueva.
