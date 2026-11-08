# Plan de acción

Estado a 2026-11-07. Lo que está en orden va en orden; lo que es idea de futuro
va marcado como tal. El estado operativo de producción vive en [`DEPLOY.md`](DEPLOY.md).

## Estado de partida

- **Producción**: `https://patrulla-antimosquitos.com` (Apache, apex only, TLS
  Let's Encrypt). Deploy pull-based: push a `main` → tests → SSH → el servidor
  hace `git fetch` + build + release + swap + smoke, con rollback automático.
  Timer cada 15 min como red de seguridad.
- **Staging**: `https://patrulla-staging.server.brobert.net` (CapRover, máquina
  personal). Desplegado **a mano** una vez (`caprover deploy --tarFile`), sin
  automatización. Comparte el proyecto Supabase de producción.
- **Supabase**: proyecto `levdxusiudrtutmkyomn`, plan **Free**, propiedad de la
  agencia que desarrolló la app. Todas las tablas con RLS; hay una auditoría con
  fallos vivos (ver Fase 5).
- **App**: PWA estática, sin backend propio. `index.html` 408 KB, `admin.html`
  81 KB, `admin-reportes.html` 58 KB.
- **Tests**: 39 tests (Bun + happy-dom + Supabase falso en memoria). Cubren
  estructura, build, navegación y flujos con datos simulados.
- **Push**: la mitad cliente está hecha (suscripción, prefs, handler en `sw.js`).
  El emisor no existe. Nunca se ha enviado una notificación.

## Decisiones ya tomadas

| Decisión | Motivo |
|---|---|
| Producción = Apache estático con releases + symlink | es una PWA sin backend; Docker sólo añade superficie |
| Deploy pull-based (el servidor builda) | no se suben artefactos; rollback en segundos |
| Staging = CapRover (Docker) | separa entornos y permite previews |
| Supabase se mantiene (por ahora) | RLS ya auditado, auth y storage listos; migrar ahora es big-bang |
| Organización de Supabase propia de la fundación | la agencia no debe poder facturar, transferir ni cortar el acceso |
| `www` no existe: apex only | es una app de móvil |
| Repo público, sin secretos dentro | `anon key` es pública por diseño; `service_role` nunca en el repo |

## Fase 1 — Cerrar `deploy/caprover-staging`

- [ ] Merge selectivo a `main`: `Dockerfile`, `.dockerignore`,
      `captain-definition`, `TESTING.md`, `README.md` (+16 líneas de tests).
- [ ] **No** mergear `docs/supabase-hardening.md` ni `docs/audit/*.sql`: el repo
      es público y ese documento explica cómo explotar fallos vivos.
- [ ] Limpiar documentación en `main`: recortar `deploy/README.md` (hoy 180
      líneas con borradores de GitLab y Apache que duplican `DEPLOY.md`), borrar
      `deploy/gitlab-ci.example.yml` y `deploy/apache.conf.example`.
- [ ] Añadir sección **Staging** a `DEPLOY.md`.
- [ ] `docs/` del audit pasa a la rama nueva (Fase 7), no a `main`.
- [ ] Borrar la rama: `git branch -d` + `git push origin --delete`.

## Fase 2 — Supabase: propiedad y plan

Va antes que nada más de Supabase, porque no toca código.

- [ ] Crear organización propia de la fundación (cuenta corporativa, no personal).
- [ ] Pasar esa organización a **Pro** (~25 $/mes): sin pausas por inactividad,
      backups diarios, *restore to new project*, SMTP propio, más cuota.
- [ ] Que la agencia transfiera el proyecto (*Settings → General → Transfer
      project*). Requiere ser Owner de la org origen y miembro de la destino.
      **La transferencia conserva el `project ref`, la URL, las claves, el auth,
      el storage y las Edge Functions**: no hay dump, y no cambian `config.js`,
      las CSP ni `_foto_valida`.
- [ ] Invitar a la agencia como **Developer** en el proyecto (trabajan, no
      transfieren ni cambian ajustes).
- [ ] Rotar lo sensible: `service_role`, contraseña de la BD, SMTP, y la VAPID
      privada si apareciera. La transferencia **no** rota claves.
- [ ] Confirmar región del proyecto (debería ser EU; no se puede cambiar después).

## Fase 3 — Staging real

- [ ] Crear proyecto `patrulla-staging` con *restore to new project* (BD completa,
      incluidos usuarios de auth).
- [ ] **Copiar los objetos de Storage** aparte: el restore es sólo base de datos.
      Sin fotos, `createSignedUrls()` devuelve 404 y las pruebas de fotos no valen.
- [ ] Ajustar lo que cambia con un proyecto nuevo: `<meta>` CSP de las tres
      páginas, `config.js` o variables de entorno en CapRover, y `Auth → Site URL`
      + *Redirect URLs* con el dominio de staging.
- [ ] CapRover → *Deployment → Method 3 (GitHub)*: repo `ScienseedSCS/patrulla`,
      branch `main`, `Dockerfile`, auto-deploy. Staging pasa a ser un canary de
      `main`, no una rama aparte.
- [ ] Arreglar `_foto_valida` (hardcodea el proyecto de producción) antes de
      usarlo para probar fotos. Es parte de la Fase 5.

## Fase 4 — Esquema y tests en el repo

Hoy el esquema sólo existe dentro de Supabase. Eso impide entornos reproducibles
y tests de integración reales.

- [ ] `supabase/migrations/` con el esquema versionado (extraído del proyecto
      actual, idempotente).
- [ ] `seed.sql` mínimo: ciudades, `ovi_*`, `tips`, `action_types`, preguntas.
- [ ] Tests de RLS con **pgTAP** contra Postgres local (`supabase test db`):
      "usuario no autorizado no lee el objeto", "sólo el dueño borra", "el bucket
      es privado". Rápidos, deterministas, en cada push.
- [ ] El harness actual (Bun + happy-dom + fake) se queda para unidad y
      estructura; **no** puede probar RLS ni URLs firmadas, y no debe intentarlo.

## Fase 5 — Hardening de Supabase

Prioridad: los tres primeros son fallos vivos en producción, no deuda estética.
El detalle está en `docs/supabase-hardening.md` (se trae de la rama cerrada).

- [ ] `resolve_report_consensus` es ejecutable por `anon` y no comprueba quién
      llama: permite recalcular `review_count` y resolver reportes ajenos.
- [ ] `delete_my_report` resta puntos dos veces si el reporte estaba `descartado`.
- [ ] Se pueden insertar reportes sin foto y cobrar los puntos de la acción.
- [ ] `trg_spot_sumar_puntos` ignora `found` (puntos sin encontrar criaderos).
- [ ] `trg_learnqc_sumar_puntos` no valida la respuesta (2 puntos por insertar).
- [ ] `_foto_valida` hardcodea el proyecto de producción.
- [ ] Cooldown real con `action_types.cooldown_days` (hoy la UI lo promete y la
      base no lo aplica).
- [ ] Decidir el modelo de revisión: `check_report_validation` (3 votos) es código
      muerto; la función activa resuelve con el primer voto. README dice 3, la UI
      dice 1, la base hace 1.

## Fase 6 — Push (la "Fase 2" del producto)

La app ya tiene la mitad cliente y la taxonomía definida en `index.html`:
`rutina`, `contenido`, `comunidad`, `riesgo`, `revisor`, con horario de silencio
22–08 y payload `{ title, body, icon, tag, url, section }` (`sw.js`).

- [ ] Recuperar o generar el par VAPID. **Pendiente: preguntar a la agencia si
      conservan la privada.** Si se genera nuevo, hay que volver a suscribirse
      (asumible si aún no hay usuarios reales).
- [ ] Tabla `push_outbox` como cola: los triggers (reporte validado/rechazado) y
      los jobs (riesgo, ronda semanal) **encolan**; un dispatcher drena.
- [ ] Dispatcher: cruza `push_prefs`, respeta silencio 22–08, limita por usuario,
      envía con `web-push`, poda endpoints muertos (404/410), reintenta.
- [ ] Definir la zona horaria del silencio (`profiles.timezone` o asumir ART).
- [ ] Definir "riesgo elevado" por ciudad (regla concreta, no un umbral inventado).
- [ ] Dónde corre el dispatcher: Edge Function + `pg_cron` (menos infra) o cron en
      el EC2 (más control). Decidir en ese momento.

Coste: **0**. Ni cuenta de Firebase ni Apple Developer Program para web push; los
endpoints de FCM y APNs ya vienen en cada suscripción y se autentican con VAPID.

## Fase 7 — Modularización

Rama nueva: `refactor/tests-modularidad`.

- [ ] **Capa de datos primero**: todas las queries y RPC detrás de un único
      módulo (`src/data.js`). Es la condición que hace barata cualquier migración
      de backend futura.
- [ ] Extraer de `index.html` por funcionalidad, no por capas: auth, reportes,
      revisión, perfil, invitado. Un corte, tests verdes, siguiente corte.
- [ ] `tests/static/size-budget.test.js` es el **ratchet**: cada extracción debe
      bajar el presupuesto, nunca subirlo.
- [ ] E2E con navegador real contra staging (Playwright) para los flujos que el
      fake no puede cubrir: subir/ver/borrar foto con sesión real. Nightly o
      manual, no en cada push.
- [ ] Endurecer CSP cuando no queden scripts inline.

## Planes de futuro (sin fecha)

- **GitHub Pages**: hoy está activo y publica una copia del repo en
  `scienseedscs.github.io/patrulla` en cada push. Se mantiene mientras el equipo
  lo use para previsualizar; se apaga cuando usen producción o staging.
- **Play Store**: PWA empaquetada como TWA (Bubblewrap, 25 $ una vez). Web push
  sigue funcionando igual.
- **App Store**: envoltorio nativo y cuenta de 99 $/año; Apple rechaza apps "que
  sólo muestran un login" (guideline 4.2). La app tiene suficiente producto
  propio, pero es pelea de otro momento.
- **Salida de GitHub**: el repo es público y el remote está en GitHub. Migrar a
  otro host (o self-hosted) no afecta al servidor: sólo cambia el `origin`.
- **Emails transaccionales**: hoy los de auth salen con el remitente de Supabase.
  Con Pro se puede poner SMTP propio.
- **Optimización de imágenes**: `caso1.png` (3 MB) está en el repo y no se
  publica; la carpeta de assets de la app no está comprimida de forma agresiva.

## Criterios para revisitar el backend

No se decide ahora: se decide **después** de la Fase 7, y con el disparador
escrito para que no sea una corazonada. Cualquiera de estos abre la conversación:

1. Coste sostenido por encima de ~25–50 €/mes.
2. Techo de cuota: 500 MB de BD o 1 GB de storage (con fotos: ~200 KB por
   reporte, o sea ~5.000 fotos por GB).
3. Más de un job de servidor, o sea, que el dispatcher de push deje de ser la
   excepción.
4. Que el equipo vaya a escribir backend de todas formas.

Y la condición técnica que hace barata esa migración es la capa de datos de la
Fase 7. Sin ella, es un big-bang sobre 400 KB de HTML.

## Deuda conocida

- Staging comparte base de datos con producción → no vale para probar escrituras
  hasta la Fase 3.
- `index.html` sigue siendo un monolito con presupuesto de tamaño vigilado.
- La VAPID privada no está en ningún sitio conocido → decisión pendiente.
- El repo es público: la auditoría no puede vivir en `main` hasta que los fallos
  estén corregidos.
- CapRover y el servidor de producción son máquinas distintas, ambas sin
  monitorización (nadie avisa si el sitio se cae).
