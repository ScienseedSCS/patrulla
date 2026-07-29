# Patrulla Antimosquito · PWA (versión que reusa tu Supabase)

App instalable de prevención del dengue para Fundación Mundo Sano. Esta versión **reaprovecha el Supabase que ya tenías** (con tus datos ya cargados) y arregla el motivo por el que Reportar, Tips y Quizzes salían vacíos.

- **Frontend:** un único `index.html` autónomo (HTML + CSS + JS embebidos), servido desde GitHub Pages.
- **Backend:** tu proyecto de Supabase actual (no cambia el esquema ni se pierden datos).
- **El bug estaba en la seguridad (RLS):** faltaban las políticas de *lectura* en las tablas de catálogo. Sin ellas, Supabase devuelve 0 filas **sin dar error**.

---

## Qué hay en cada archivo

| Archivo | Qué es | ¿Lo tocás? |
|---|---|---|
| `index.html` | La app completa (todo embebido). | No |
| `config.js` | Tus credenciales de Supabase. | **Ya viene con las tuyas** |
| `supabase-fix.sql` | El parche que arregla el bug (RLS + storage). | Se corre una vez |
| `manifest.webmanifest` | Hace la app instalable. | No |
| `sw.js` | Service worker (instalación + carga rápida). | No |
| `icons/` | Íconos de la app + logo. | Reemplazá el de Mundo Sano por el oficial |

> Nota: tus viejos `app.js` y `styles.css` quedaron obsoletos — todo está dentro de `index.html`. Podés borrarlos del repo.

---

## Puesta en marcha (2 pasos)

### Paso 1 · Aplicar el arreglo en Supabase  ← esto destraba la app

1. Entrá a tu proyecto en **supabase.com**.
2. Menú izquierdo → **SQL Editor → New query**.
3. Abrí `supabase-fix.sql`, copiá **todo**, pegalo y apretá **Run**.

Ese script **no borra nada**: agrega las políticas de lectura que faltaban (el arreglo principal), reasegura las demás, confirma el bucket de fotos `reports` y agrega la columna `photo_before_url` (para las fotos "antes/después"). Es seguro correrlo varias veces.

> Si ya lo habías corrido antes de esta versión, **volvé a correrlo**: ahora incluye la columna nueva para el modo antes/después.

### Paso 2 · Subir los archivos al repo

Subí al repositorio **ScienseedSCS/patrulla** (podés arrastrarlos en *Add file → Upload files*), respetando la carpeta `icons/`:

```
index.html
config.js
manifest.webmanifest
sw.js
icons/  (icon-192.png, icon-512.png, icon-maskable-512.png, mundo-sano-logo.svg)
```

`config.js` **ya trae tus credenciales**, así que no hace falta editarlo. GitHub Pages ya está activo en `https://scienseedscs.github.io/patrulla/`; en un minuto vas a ver los cambios.

> Recordá la lección de la vez pasada: no edites estos archivos en el editor web de GitHub (rompe atributos y corta archivos largos). Subilos tal cual. El único que podrías necesitar cambiar es `config.js`, que es cortito.

Recargá la página con **recarga forzada** (Ctrl/Cmd + Shift + R) y listo: Reportar, Tips y Quizzes ya muestran los datos.

---

## Instalar la app en el teléfono

- **Android (Chrome):** abrí la dirección → menú **⋮** → *"Instalar app"* / *"Agregar a la pantalla de inicio"*.
- **iPhone (Safari):** abrí la dirección → **Compartir** → *"Agregar a inicio"*.

---

## Cómo quedó la lógica (para que sepas qué esperar)

- **Auth:** email + contraseña, con recuperación de contraseña incluida (el enlace del email abre una pantalla para poner la nueva). Si tenés *Confirm email* desactivado, el registro entra directo.
- **Reportar:** flujo de 3 pasos. En el paso de la foto se puede elegir **foto simple** (puntos normales) o **antes y después** (dos fotos, +5 pts extra y más fácil de revisar). Las fotos se suben al bucket `reports` (carpeta `usuario/…`); la principal queda en `reports.photo_url` y la de "antes" en `reports.photo_before_url`. En Revisar, los reportes antes/después muestran las dos fotos lado a lado.
- **Revisar:** se **desbloquea a los 350 pts** (nivel 🛡️ Guardián). Muestra reportes pendientes de otras personas; cada voto suma +3 y usa tu trigger de consenso (3 votos "correcto" → validado).
- **Aprender:** tips (+2 la primera lectura) y quizzes (+5 al acertar).
- **Puntos y niveles:** 🥚0 · 🐛50 · 🦟150 · 🛡️350 · 🏆700 · ⭐1200.

### Sobre los puntos (una nota honesta)
En tu diseño, los puntos los suma la app actualizando `profiles.points`. Es simple y funciona, pero significa que, técnicamente, alguien con conocimientos podría inflar su puntaje desde la consola del navegador. Para un piloto de concienciación es un riesgo aceptable. Si más adelante querés blindarlo, se puede pasar el cálculo de puntos a *triggers* del lado del servidor; te lo dejo anotado como mejora.

---

## Metadata de los reportes y privacidad

La app puede adjuntar a cada reporte, **de forma opcional y con consentimiento**, datos que ayudan a mapear y validar focos:

- **Ubicación aproximada** (`reports.lat` / `reports.lng`): sólo si la persona activa el interruptor "Adjuntar ubicación" y acepta el aviso. Las coordenadas se guardan con **precisión reducida a ~100 m** (3 decimales), no la dirección exacta. La precisión informada por el GPS queda en `reports.geo_accuracy`.
- **Fecha y hora del dispositivo** (`reports.captured_at`).
- **Huella de la foto** (`reports.photo_hash`, SHA-256): detecta si una misma imagen se reutiliza en varios reportes. En Revisar, si una foto aparece en más de un reporte, se muestra una alerta.

Decisiones de privacidad tomadas (alineadas con GDPR / LGPD de Brasil / Ley 25.326 de Argentina):

- **Consentimiento explícito, opt-in.** La ubicación está desactivada hasta que la persona la activa y acepta un aviso claro (qué se recoge, para qué, quién lo administra). El consentimiento se guarda en `profiles.geo_consent` y se puede revocar en cualquier reporte. **Reportar funciona igual sin ubicación.**
- **Minimización.** Precisión a nivel de barrio; no se guarda la dirección exacta.
- **Se quitan los metadatos EXIF de las fotos.** Antes de subir, la imagen se re-codifica en el navegador (canvas), lo que elimina el GPS y demás metadatos que la cámara incrusta. Así la única ubicación almacenada es la consentida, con la precisión que definimos. De paso, las fotos quedan más livianas.
- **Transparencia.** El aviso está a un toque desde el reporte ("¿Qué datos se recogen?").

> Para producción: sumá una **política de privacidad** enlazada, definí **plazo de retención** de reportes/fotos y un mecanismo de **acceso y borrado** (borrar la cuenta y sus datos). Si va a haber datos de personas de la UE, conviene revisión de un responsable de protección de datos. Los revisores ven la ubicación aproximada de los reportes que revisan; si querés restringirlo, se puede limitar la lectura de `reports` sólo a revisores. Esto es orientación de diseño, no asesoramiento legal.

Para ajustar la precisión, cambiá `GEO_PRECISION` en `index.html` (3 = ~110 m; 2 = ~1,1 km).

---

## Si algo no aparece

- **Reportar/Tips/Quizzes vacíos** → casi seguro falta correr `supabase-fix.sql` (Paso 1), o correrlo de nuevo.
- **La foto no sube** → revisá que en Supabase → **Storage** exista el bucket `reports` y sea **público** (el script lo crea si falta).
- **No entra con la contraseña** → en Supabase → Authentication, confirmá el estado de *"Confirm email"*.
- **Errores en pantalla** → la app tiene una **barra roja arriba** que muestra el detalle; ese texto ayuda a diagnosticar.

---

## Mejoras que quedan anotadas (opcionales)

- Puntos server-side con triggers (blindaje anti-trampa).
- Mapa con Leaflet/OpenStreetMap (los campos `lat`/`lng` ya existen en `reports`).
- Panel de administración para que Mundo Sano actualice la incidencia semanal.
- SMTP propio (Resend/Brevo) para no depender del límite de emails de Supabase.
- Racha semanal (`streak_weeks` ya existe, falta calcularla).

---

*El logo de la app vive en `icons/logo.png` (versión con fondo transparente, para que se vea bien sobre la cabecera y el login). Los íconos de instalación (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) se generaron con tu logo sobre el fondo berenjena del tema. Si cambiás el logo, reemplazá `icons/logo.png` (y regenerá los íconos) y **subí el número de versión en `sw.js`** — de `patrulla-v2` a `patrulla-v3` — para que la caché no siga mostrando el viejo.*
