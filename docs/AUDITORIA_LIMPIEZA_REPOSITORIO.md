# Auditoría de reducción del repositorio — v1.3.1

## Resultado ejecutivo

- Estado original: **102 archivos**, ~**1,7 MB**.
- Runtime real: **17 archivos**.
- Repositorio limpio: **41 archivos**.
- Paquete de despliegue: **17 archivos**.
- Reducción del repositorio: **61 archivos** (59.8%).
- Código funcional modificado: **ninguno**.
- Cambios no funcionales: nombres estables de QA/metadatos, consolidación documental, reorganización de SQL históricos y herramienta de empaquetado.

## Hallazgos

1. Había 43 archivos Markdown, principalmente README, handoff, QA y adendas por versión.
2. Existían cinco archivos de checksums completos y cuatro parches `.diff` en la rama principal.
3. Había scripts QA duplicados por versión; v1.3.1 ya comprueba regresiones de v1.1.1–v1.3.0.
4. `supabase_setup.sql` era, tras normalizar espacios, exactamente `supabase_schema.sql` + `supabase_seed.sql`.
5. El límite observado de GitHub corresponde a la carga simultánea mediante navegador, no a un límite de 100 archivos del repositorio.
6. La carpeta raíz mezclaba runtime, documentos, SQL, parches y artefactos de auditoría, dificultando revisar qué se despliega.

## Decisiones

### Se conserva en la rama principal

- Los 17 archivos de runtime.
- La documentación actual con nombres estables.
- El changelog y manifiesto actual.
- Migraciones separadas e inmutables.
- QA actual y pruebas de regresión.
- Esquema/seed y manifiesto de imágenes.

### Se consolida

- 41 documentos Markdown históricos → `docs/HISTORIAL_DOCUMENTAL_CONSOLIDADO.md`.
- 3 verificaciones Supabase vigentes → `QA/verify_supabase_current.sql`.
- QA versionada → archivos estables `qa_static.py`, `qa_browser.py`, `test_session_core.js`.

### Se retira de la rama principal y se archiva

- README/handoffs/adendas/QA históricos individuales.
- Parches `.diff` de releases cerrados.
- Checksums y manifiestos de releases anteriores.
- Scripts QA sustituidos.
- CSV/XLSX piloto redundantes con `pilot-data.js` y el seed.
- `supabase_setup.sql`, por duplicar esquema + seed.

## Razón técnica

Git ya conserva el historial por commit. Los tags identifican puntos importantes y GitHub Releases permite adjuntar ZIP, parches, manifiestos y checksums de una versión cerrada. Mantener esas copias dentro de la rama activa duplica la historia y aumenta el ruido de auditoría. Las migraciones son la excepción: deben conservarse como pasos secuenciales, porque su orden y contenido forman parte del estado reproducible de la base.

## Guardrails

- No se alteraron hashes de ningún archivo de runtime.
- El service worker sigue encontrando todos sus recursos.
- La QA estática y el smoke de navegador deben pasar después de la limpieza.
- El archivo histórico debe publicarse como asset del release/tag v1.3.1 antes de eliminar los originales del repositorio remoto.
- No eliminar la historia existente de Git ni hacer `force push` para “limpiar” versiones anteriores.

## Flujo recomendado en adelante

1. Desarrollar y auditar en el repositorio limpio.
2. Modificar archivos actuales en vez de crear copias con sufijo de versión.
3. Crear tag/release para cada versión estable.
4. Adjuntar al release el ZIP de runtime, el archivo histórico cuando corresponda y un checksum del ZIP.
5. Mantener `main` con código actual, pruebas actuales, migraciones y documentación vigente.
