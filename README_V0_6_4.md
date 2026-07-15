# Residentado app v0.6.4

## Incorrecta + `?`
Una respuesta incorrecta con una o más alternativas marcadas con `?` recibe prioridad adicional:
- mayor aumento de dificultad;
- reducción mayor de estabilidad de memoria;
- intervalo de repaso más corto;
- bonificación extra en la selección adaptativa.

Una respuesta correcta con `?` también se prioriza, pero menos que una incorrecta con `?`.

## Informe dinámico de debilidades
Accesible desde:
- Practicar → `Informe dinámico de debilidades`
- Estadísticas → `Ver informe`

Se recalcula con cada nueva respuesta y usa:
- estado más reciente por pregunta;
- errores actuales;
- dudas `?`;
- error + `?`;
- lentitud;
- errores recientes;
- repasos vencidos.

El índice 0–100 es una heurística interna de priorización y no predice la nota del examen.

Incluye:
- ranking de temas;
- prioridad Crítica / Alta / Moderada / Vigilancia / Controlada;
- evidencia Baja / Media / Alta;
- dominio actual;
- porcentaje de dudas;
- porcentaje de error + duda;
- lentitud;
- cobertura;
- práctica directa del tema;
- botón `Copiar informe para ChatGPT`;
- brechas de cobertura separadas para no confundir “no estudiado” con “débil”.

## Base de datos
No requiere migración SQL nueva si ya aplicaste `supabase_migration_v0_6_2.sql`.
