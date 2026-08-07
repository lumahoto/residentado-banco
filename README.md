# Residentado v1.3.1

Webapp estática para práctica del banco de Residentado Médico Perú. Esta rama conserva el runtime v1.3.1 sin cambios funcionales y usa una estructura de repositorio reducida para facilitar auditorías y cargas por la interfaz web de GitHub.

## Estructura

- **Raíz:** archivos de runtime, versión y metadatos actuales.
- **`QA/`:** una prueba estática vigente, un smoke de navegador, un test unitario y una verificación consolidada de Supabase.
- **`MIGRATIONS/`:** migraciones inmutables; las antiguas están en `legacy/`.
- **`DATABASE/`:** esquema y seed del piloto, separados. `supabase_setup.sql` se retiró porque era exactamente la concatenación normalizada de ambos.
- **`docs/`:** auditoría de limpieza e historial Markdown consolidado.
- **`tools/`:** generador del paquete de despliegue con solo los archivos que ejecuta la webapp.

## Runtime

La lista autoritativa está en `RUNTIME_FILES.txt` y contiene 17 archivos. `index.html` y `service-worker.js` cargan o precachean ese mismo conjunto. La documentación, QA, migraciones y archivos históricos no participan en la ejecución ordinaria.

## Validación

```bash
python3 QA/qa_static.py
python3 QA/qa_browser.py
```

El smoke de navegador requiere Playwright y Chromium. La prueba estática requiere Python 3 y Node.js.

## Crear el ZIP de despliegue

```bash
python3 tools/build_runtime_zip.py
```

El script crea `residentado-runtime-v1.3.1.zip` fuera de la carpeta del repositorio, con 17 archivos y su SHA-256. Ese ZIP es apropiado para desplegar la webapp; para auditorías de código debe compartirse el repositorio limpio completo.

## Publicación segura

1. Conservar el release/tag anterior.
2. Subir el repositorio limpio o usar Git/ GitHub Desktop.
3. No ejecutar migraciones ya aplicadas por rutina.
4. Publicar el ZIP de runtime si el hosting solo necesita la aplicación.
5. Ejecutar QA y el smoke real con Supabase.
6. Confirmar `v1.3.1`, caché `residentado-v1-3-1`, PT409, sesiones, notas, flags y catálogo TTS.

## Historia y trazabilidad

- `CHANGELOG.md` resume los cambios funcionales.
- `RELEASE_MANIFEST.json` describe el release vigente.
- `docs/HISTORIAL_DOCUMENTAL_CONSOLIDADO.md` conserva el contenido literal de los Markdown retirados.
- El ZIP histórico conserva los archivos originales retirados, incluidos parches, manifiestos, checksums y QA anteriores.
- En GitHub, las versiones cerradas deben marcarse con tags y releases; no deben mantenerse copias versionadas de README, QA o checksums en la rama principal.

## Regla para futuras versiones

Actualizar los archivos de nombre estable (`README.md`, `RELEASE_MANIFEST.json`, `CHECKSUMS_SHA256.txt`, `QA/qa_static.py`, `QA/qa_browser.py`) en vez de crear uno nuevo por cada versión. Las migraciones sí mantienen fecha y nombre propios porque representan cambios secuenciales de base de datos.
