# Residentado — v0.6.9

Actualización final de interfaz sobre v0.6.8.

## Cambios

- Muestra `v0.6.9` en letras pequeñas en la barra superior de la webapp y en la pantalla de inicio de sesión para facilitar el trazado durante pruebas.
- Reemplaza la lista plana de temas del constructor de práctica por un navegador jerárquico dinámico:
  - Área → Especialidad → Tema.
- Añade buscador por área, especialidad o tema.
- Añade conteos de temas y preguntas.
- Permite seleccionar o limpiar todos los temas de un área o especialidad.
- Mantiene los filtros existentes de área, año, estado previo y rentabilidad.
- No requiere cambios en Supabase ni nuevas migraciones SQL.

## Ejemplo de navegación

Para buscar un bloque pediátrico concreto:

1. Pulsa `Ninguno` en temas.
2. Escribe `exantemas` en el buscador, o despliega `Pediatría` y la especialidad correspondiente.
3. Marca el tema deseado.
4. Crea la sesión.

La jerarquía se construye automáticamente con los campos `area`, `specialty` y `topic` de las preguntas cargadas en Supabase, por lo que se actualiza al importar nuevos bancos enriquecidos.
