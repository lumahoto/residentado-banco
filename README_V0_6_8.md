# Residentado — actualización v0.6.8

Fecha: 2026-07-15

## Objetivo

Cerrar la etapa de ajustes de la webapp antes del merge a la rama principal, añadiendo una alerta de lectura prioritaria basada en errores reales y haciendo robusta la mezcla de alternativas.

## Cambios

### 1. Mezcla de alternativas con protección automática

- Se mantiene la mezcla de alternativas introducida en v0.6.7 para práctica y simulacro personalizado.
- La app conserva la correspondencia con la alternativa canónica para corregir, registrar dudas y calcular estadísticas.
- El simulacro histórico realista conserva el orden oficial del cuadernillo.
- Como protección adicional, si una pregunta contiene alternativas que hacen referencia explícita a letras u otras opciones, la app mantiene el orden canónico de esa pregunta.
- Se auditó el `banco_maestro_raw_2015_2025_v0_1` de 2.180 preguntas y no se encontraron alternativas del tipo «A y B», «todas las anteriores» o «ninguna de las anteriores» que invaliden la mezcla actual.

### 2. Alerta de lectura prioritaria

- La pantalla principal puede mostrar `🚨 ALERTA DE LECTURA PRIORITARIA` cuando existe un tema con señal suficiente de debilidad.
- La selección usa el informe dinámico ya existente: errores recientes, duda `?`, error + duda, lentitud, repasos vencidos y nivel de evidencia.
- Prioriza temas críticos o altos con evidencia media/alta; puede mostrar una señal crítica temprana si el problema es muy marcado.
- La alerta muestra:
  - tema;
  - dominio actual;
  - prioridad;
  - cobertura;
  - motivo de alerta;
  - focos de lectura sugeridos.
- Incluye:
  - `📋 Copiar pedido de repaso`, para pegar un prompt dirigido en ChatGPT;
  - `🔥 Practicar este tema`, para iniciar un refuerzo de 10 preguntas.
- La misma alerta aparece también en `Qué viene después`.

### 3. Compatibilidad

- No requiere cambios SQL.
- Compatible con la migración v0.6.2 ya aplicada.
- El paquete de actualización v0.6.8 está preparado para instalarse directamente sobre la v0.6.6 probada; incluye de forma acumulativa los cambios de v0.6.7 y v0.6.8.

## Nota editorial

La definición de epónimos y la comparación de mecanismos de acción farmacológicos siguen siendo requisitos del contenido del banco. No requieren nuevas columnas ni una migración de Supabase: se muestran mediante los campos de explicación ya existentes.
