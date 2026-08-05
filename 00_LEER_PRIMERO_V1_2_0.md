# LEER PRIMERO — Residentado v1.2.0

Esta versión debe publicarse **sobre v1.1.1**, no sobre v1.1.0-rc2 ni sobre v1.1.0-rc3.

1. Conserva una copia del despliegue v1.1.1 y no borres IndexedDB, caché ni datos locales.
2. El hotfix PT409 de v1.1.1 debe permanecer aplicado. No restaures SQLSTATE 40001.
3. Ejecuta una sola vez `MIGRATIONS/20260805_ADD_QUESTION_LEARNING_NOTES_V1_2_0.sql` en Supabase.
4. Publica **todos** los archivos, incluido `version.js`.
5. Recarga dos veces; si la webapp está instalada como PWA, ciérrala por completo y vuelve a abrirla.
6. Confirma que la interfaz muestre `v1.2.0`.
7. Prueba una nota, una revisión parcial y la numeración de Cobertura antes de continuar el estudio normal.

Las notas son independientes de los flags de auditoría y no modifican respuestas, memoria, sesiones ni preguntas.
