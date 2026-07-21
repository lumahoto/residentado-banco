# QA — Residentado v1.0.0

## Validaciones automáticas realizadas

- `node --check app.js`: sin errores de sintaxis.
- Renderizado en Chromium sin errores JavaScript.
- Vista móvil simulada: 390 × 844 px.
- Vista escritorio simulada: 1440 × 900 px.
- Retroalimentación inmediata funcional.
- `Referencia rápida` presente solo con contenido y cerrada por defecto.
- Comparación farmacológica estructurada en tarjetas por aspecto.
- Variantes vacías de abreviaturas ocultas.
- Preguntas con cuatro alternativas: no aparece una quinta alternativa vacía.
- Pregunta con imagen: el activo se renderiza.
- Preguntas `OBSERVADA_*`: excluidas de práctica adaptativa actual.
- Ciclo de flag en modo local:
  - marcar;
  - cambiar motivo;
  - registrar parche;
  - retirar de pendientes;
  - conservar en historial;
  - mostrar identificador y resumen del parche.
- Diseño móvil del historial revisado visualmente.

## Validaciones que debe hacer el usuario después de desplegar

Estas pruebas requieren la cuenta y Supabase reales:

1. Iniciar sesión en móvil Samsung y escritorio.
2. Confirmar 2.180 preguntas y 274 temas.
3. Abrir `RM-2022-A-038` y verificar su electrocardiograma.
4. Marcar una pregunta de prueba y confirmar que sincroniza entre dispositivos.
5. Registrar un parche de prueba y confirmar que pasa de Pendientes a Historial.
6. Verificar una pregunta `OBSERVADA_AMBIGUA` en simulacro histórico.
7. Completar una sesión de 10 preguntas y confirmar intentos, duda `?`, memoria e historial.
8. Borrar o cerrar el flag de prueba cuando termine la validación.

## Resultado

La Fase B queda implementada. La auditoría médica y farmacológica total pertenece a la siguiente fase y no debe confundirse con esta mejora de presentación.
