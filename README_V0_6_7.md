# Residentado — actualización v0.6.7

Fecha: 2026-07-15

## Objetivo

Cerrar la etapa de desarrollo de la webapp con una protección adicional contra la memoria de posición/letra de las alternativas.

## Cambios

### 1. Mezcla de alternativas

- En las sesiones de práctica, las alternativas se mezclan por defecto.
- Las letras visibles A–E se reasignan a la nueva posición.
- Internamente se conserva la correspondencia con la alternativa oficial original, por lo que:
  - la corrección sigue siendo exacta;
  - las dudas `?` se guardan contra la alternativa real;
  - la memoria adaptativa y las estadísticas no cambian de significado.
- El orden queda estable durante toda la pregunta y durante su revisión posterior.

### 2. Configuración en práctica y simulacro personalizado

En el constructor aparece la opción:

`Mezclar alternativas`

Está activada por defecto.

### 3. Simulacro histórico realista

El modo histórico conserva el orden oficial de alternativas para mantener fidelidad al cuadernillo original.

### 4. Compatibilidad

- No requiere cambios SQL.
- Compatible con la migración v0.6.2 ya aplicada.
- Puede instalarse directamente sobre v0.6.6.

## Nota editorial

Los requisitos de definir epónimos y ampliar la comparación de mecanismos de acción farmacológicos son requisitos del contenido del banco, no del esquema visual de la aplicación. Se incorporan al estándar editorial y se mostrarán en los bloques de explicación ya existentes a medida que los bancos sean enriquecidos/auditados.
