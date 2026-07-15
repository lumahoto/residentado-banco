# Residentado — v0.6.11

Actualización de navegación y protección de taxonomía sobre v0.6.10.

## Cambios

- La interfaz muestra la versión `v0.6.11`.
- Añade una capa defensiva para conservar las 6 áreas canónicas aunque una importación futura use variantes antiguas.
- Las etiquetas de tema o especialidad puramente numéricas ya no se muestran como categorías válidas.
  - Si `topic` es inválido y existe un `subtopic` útil, se usa el subtema como etiqueta de navegación.
  - Si no hay una etiqueta válida, se usa `Sin tema clasificado`.
- El navegador de temas sigue la jerarquía `Área → Especialidad → Tema`.
- Los grupos se muestran plegados inicialmente para reducir el desplazamiento en celular.
- El buscador abre automáticamente las áreas y especialidades que contienen coincidencias.
- El formulario impide iniciar una sesión con cero áreas, cero años o cero temas seleccionados.
- No requiere migración SQL adicional.

## Compatibilidad

Compatible con el esquema de Supabase usado desde la migración v0.6.2. No modifica preguntas, intentos, memoria adaptativa ni estadísticas.
