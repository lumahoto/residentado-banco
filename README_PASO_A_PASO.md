# Residentado — banco piloto

Esta carpeta contiene una PWA funcional con las 20 preguntas del piloto.

## Qué ya funciona sin configurar nada

Abre `index.html` y la app entra en **Modo demo**:

- 20 preguntas reales.
- Corrección inmediata.
- Explicación de la clave.
- Explicación de distractores.
- Alertas de auditoría.
- Modo de 20 segundos.
- Repaso de errores.
- Estadísticas.
- Progreso guardado en `localStorage` del navegador.

En modo demo el progreso **no se sincroniza** entre celular y laptop.

Para probarla mediante un servidor local:

```bash
python -m http.server 8000
```

Luego abre:

```text
http://localhost:8000
```

---

# Paso en el que necesitas intervenir: configurar Supabase

## 1. Crear un proyecto en Supabase

Crea un proyecto gratuito en tu cuenta.

## 2. Crear la base de datos

En el **SQL Editor** de Supabase:

1. Abre `supabase_setup.sql`.
2. Copia todo su contenido.
3. Pégalo en una consulta nueva.
4. Ejecuta la consulta.

Ese único archivo:

- crea `questions`;
- crea `attempts`;
- activa Row Level Security;
- crea las políticas de privacidad;
- deja el banco en solo lectura desde la app;
- carga las 20 preguntas.

## 3. Crear tu usuario

La configuración recomendada es:

- Email/password habilitado.
- **Allow new users to sign up: desactivado** cuando termines de crear tu cuenta.
- Mantener un único usuario para el piloto.

Puedes crear tu usuario desde el panel de Authentication si el panel ofrece esa acción. Otra opción es habilitar temporalmente el registro, poner `ALLOW_SIGNUP: true` en `config.js`, crear tu cuenta desde la app y luego:
1. volver `ALLOW_SIGNUP` a `false`;
2. desactivar nuevos registros en Supabase.

## 4. Copiar los datos de conexión

En Supabase busca:

- **Project URL**
- **Publishable key**

En proyectos antiguos puede aparecer una `anon key`; también sirve para el cliente web.

Nunca copies una **Secret key** ni una `service_role` dentro de esta app.

Edita `config.js`:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_...",
  ALLOW_SIGNUP: false
};
```

Cuando ambas variables están completas, la app cambia automáticamente de Modo demo a Modo sincronizado.

---

# Publicar gratis con GitHub Pages

1. Crea un repositorio, por ejemplo `residentado-banco`.
2. Sube **el contenido de esta carpeta** al nivel principal del repositorio.
3. En el repositorio abre `Settings` → `Pages`.
4. En `Build and deployment`, selecciona `Deploy from a branch`.
5. Elige la rama `main` y la carpeta `/ (root)`.
6. Guarda y espera a que GitHub publique la dirección.

La app usa rutas relativas, por lo que funciona en una URL de proyecto como:

```text
https://TUUSUARIO.github.io/residentado-banco/
```

## Instalar en Android

Abre la dirección publicada en Chrome y usa la opción de instalar/añadir la app a la pantalla de inicio cuando el navegador la ofrezca.

---

# Seguridad implementada

## `questions`
- Solo usuarios autenticados pueden leer el banco.
- La app no recibe permisos para insertar, modificar ni borrar preguntas.

## `attempts`
- Cada fila guarda `user_id`.
- RLS solo permite leer, crear, modificar o borrar filas cuando `auth.uid()` coincide con `user_id`.

Por eso, aunque en el futuro existieran varios usuarios, cada uno vería únicamente su propio historial.

---

# Archivos principales

- `index.html`: entrada de la app.
- `styles.css`: interfaz responsive.
- `app.js`: lógica de práctica, sincronización y estadísticas.
- `pilot-data.js`: copia local de las 20 preguntas para modo demo.
- `config.js`: configuración de Supabase.
- `manifest.webmanifest`: instalación PWA.
- `service-worker.js`: caché del shell de la app.
- `supabase_setup.sql`: archivo recomendado para crear todo de una sola vez.
- `supabase_schema.sql`: solo estructura y seguridad.
- `supabase_seed.sql`: solo las 20 preguntas.

---

# Regla de auditoría incorporada

- Las claves oficiales de CONAREME se conservan.
- Las preguntas `OBSERVADA_*` muestran una alerta y se excluyen del porcentaje de dominio por defecto.
- Las preguntas `VALIDADA_CON_CAVEAT` puntúan normalmente, pero muestran la precisión clínica después de responder.

---

# Estado de esta copia

Esta versión ya tiene configurados:

- Project URL de Supabase.
- Publishable key del proyecto.
- `ALLOW_SIGNUP: false`.

Por tanto, ya no inicia en Modo demo: al publicarla debe mostrar la pantalla de inicio de sesión y usar Supabase para sincronizar los intentos.
