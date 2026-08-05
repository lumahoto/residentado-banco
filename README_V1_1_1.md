# Residentado v1.1.1 - instalacion segura

Esta version estabiliza las sesiones de v1.1.0-rc2. No cambia el banco clinico, taxonomia, rentabilidad ni cobertura.

## Publicacion

1. Conservar copia del despliegue actual.
2. No borrar IndexedDB, cache ni almacenamiento local del dispositivo afectado.
3. Ejecutar MIGRATIONS/20260805_FIX_SESSION_CONFLICT_PT409.sql si aun no se aplico.
4. Publicar todos los archivos, incluido version.js.
5. Recargar dos veces; si esta instalada como PWA, cerrarla completamente y abrirla.
6. Confirmar que la interfaz muestre v1.1.1.
7. Abrir inicialmente una sola pestana.

## Recuperacion de RC2

Si la copia local conflictiva contiene progreso distinto y esta por detras del servidor, la app crea otra sesion cuyo titulo termina en recuperacion local. La original no se sobrescribe. Si no hay red, la copia queda en IndexedDB y se encola como CREATE_SESSION no destructivo.

No eliminar ninguna de las dos hasta comparar el progreso.

## Prueba minima

Responder tres preguntas, esperar dos segundos, pausar y reanudar. Abrir la misma sesion en otra pestana debe quedar bloqueado mientras el lease este vigente. Revisar Supabase cinco minutos: no deben aparecer nuevos 40001 ni crecimiento continuo de errores PostgreSQL.
