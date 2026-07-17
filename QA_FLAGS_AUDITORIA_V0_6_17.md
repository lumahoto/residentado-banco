# QA — flags de auditoría v0.6.17

1. Ejecutar `supabase_migration_v0_6_17_review_flags.sql`.
2. Abrir una práctica y responder una pregunta.
3. En la corrección, pulsar `Marcar para revisar`.
4. Probar las tres categorías y confirmar que solo queda una activa.
5. Recargar el navegador y verificar persistencia.
6. Abrir `⋮ → Preguntas para revisar`.
7. Probar filtro, copiar lista y descargar CSV.
8. Quitar un flag y verificar que desaparece del listado.
9. Confirmar que marcar o quitar flags no crea intentos y no modifica la memoria adaptativa.
10. Confirmar que los metadatos siguen ocultos antes de responder.
