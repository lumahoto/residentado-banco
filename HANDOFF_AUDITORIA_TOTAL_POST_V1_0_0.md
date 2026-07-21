# Handoff para auditoría total posterior a Residentado v1.0.0

La webapp está funcionalmente congelada. El siguiente chat debe trabajar principalmente sobre datos, no sobre interfaz.

## Fuentes canónicas

1. PDF oficial 2015–2025.
2. `BANCO_MAESTRO_CANONICO_V0721_TAXONOMIA_V2_5_2180.csv`.
3. `DICCIONARIO_TEMAS_RENTABILIDAD_V2_5_274.csv`.
4. Contexto maestro V0721.
5. Exportación nueva de flags `OPEN` desde la webapp v1.0.0.

## Regla de trazabilidad

Cada tanda aprobada debe recibir un identificador único, por ejemplo:

```text
DBPATCH-2026-07-24-01
```

Después de ejecutar y verificar el parche, registrar ese identificador en el flag mediante **Registrar parche**. No borrar el registro histórico.

## Prioridad de auditoría

1. Posible clave errónea.
2. Pregunta desactualizada o ambigua.
3. Explicación deficiente o tautológica.
4. Punto de corte, criterio diagnóstico, clasificación, escala, dosis o algoritmo preguntado.
5. Fármacos, antibióticos, antídotos, mecanismos, toxicidades y contraindicaciones.
6. Taxonomía, imagen y formato.

Dentro de cada grupo:

```text
MUY_ALTA → ALTA → MEDIA → BAJA
```

Luego priorizar errores personales, `No sé`, dudas `?`, lentitud y repetición histórica.

## Salidas esperadas de cada tanda

- SQL transaccional e idempotente;
- verificación antes/después;
- lista de preguntas modificadas;
- identificador del parche;
- exportación actualizada de `questions` y `rentability_topics` cuando corresponda;
- candidatos Anki deduplicados con tipo de dato:
  - punto de corte;
  - criterio diagnóstico;
  - clasificación;
  - escala;
  - algoritmo;
  - dosis;
  - antídoto;
  - valor normal;
  - mecanismo farmacológico.

No volver a desarrollar nuevas funciones de la app salvo error funcional real.
