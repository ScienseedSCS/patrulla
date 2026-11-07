# Deploy de Patrulla Antimosquito

Esta carpeta contiene la capa de despliegue. **No modifica la app**: sigue siendo
HTML + CSS + JS + Supabase, sin framework y sin build de aplicación.

## Qué se publica

`node scripts/build.mjs` genera `dist/` con una allowlist de archivos de runtime:

- `index.html`, `admin.html`, `admin-reportes.html`
- `supabase-js-2.117.3.js`, `fuentes.css`, fuentes `.woff2`
- `manifest.webmanifest`, `sw.js`, iconos
- `caso1.jpg` y `caso2.jpg` (imágenes de desafíos; se pueden podar si no se usan)
- `licenses/` con las licencias de las fuentes
- `robots.txt`, `build-info.json`, `healthz`

**No se publican** `README.md`, `ADMIN.md`, `caso1.png` (3 MB), `logo.png`, `.git`,
tests, migraciones ni `config.js`.

`config.js` se genera al arrancar el contenedor a partir de `SUPABASE_URL` y
`SUPABASE_ANON_KEY`. Así la misma imagen sirve para staging y producción sin
hornear credenciales.

## Build local

```bash
node scripts/build.mjs
# previsualizar con el config.js actual del repo (solo local):
COPY_CONFIG=1 node scripts/build.mjs
npx serve dist
```

## Docker local

```bash
docker build -t patrulla:local .

docker run --rm -p 8080:80 \
  -e SUPABASE_URL="https://<ref>.supabase.co" \
  -e SUPABASE_ANON_KEY="<publishable-key>" \
  patrulla:local
```

Abrir `http://localhost:8080`. El contenedor genera `/usr/share/nginx/html/config.js`
al arrancar y falla rápido si faltan las variables.

## CapRover (staging)

1. Crear la app `patrulla-staging` en CapRover.
2. En **App Settings → Environment Variables** cargar:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
3. Agregar el dominio `patrulla-staging.server.brobert.net` y activar HTTPS.
4. En **Deployment** activar **App Token** y guardarlo en las variables de GitLab.
5. Si se despliega una imagen privada de GitLab Container Registry, agregar el
   registry en **Cluster → Registries** con un token de solo lectura.
6. Desplegar con Dockerfile/Git o con una imagen ya construida:

```bash
caprover deploy \
  --caproverUrl "https://captain.server.brobert.net" \
  --caproverApp "patrulla-staging" \
  --appToken "<app-token>" \
  --imageName "registry.gitlab.com/<grupo>/<repo>:<sha>"
```

Para una prueba sin push a GitHub/GitLab también se puede usar un tar del repo:

```bash
git archive --format=tar.gz -o /tmp/patrulla-deploy.tar.gz HEAD
# o incluir cambios sin commit:
tar --exclude=.git --exclude=.fallow --exclude=dist -czf /tmp/patrulla-deploy.tar.gz .
caprover deploy --caproverUrl ... --caproverApp ... --appToken ... --tarFile /tmp/patrulla-deploy.tar.gz
```

## Supabase Auth en staging

Antes de usar login en `https://patrulla-staging.server.brobert.net`:

- En Supabase → Authentication → URL Configuration:
  - **Site URL**: `https://patrulla-staging.server.brobert.net`
  - **Redirect URLs**: agregar `https://patrulla-staging.server.brobert.net/**`
- Idealmente, usar un **proyecto Supabase de staging** separado. No apuntar
  staging al proyecto de producción con datos reales.
- Si se usa el mismo proyecto, limitar la prueba a un usuario de test y no crear
  reportes ni ejecutar acciones de administración.

> Estado actual: todavía no hay proyecto Supabase de staging. Hasta crearlo, el
> deploy de staging sirve para validar contenedor, TLS, cabeceras, PWA y login
> visual, pero **no debe usarse para datos reales**.

## Apache (producción)

La app es estática: no necesita PHP, Node ni Docker en el servidor de Mundo Sano.
Se puede servir con un vhost Apache normal, sin tocar Laravel ni WordPress.

Estructura en producción (`/var/www/html/patrulla-antimosquitos.com`):

```text
/var/www/html/patrulla-antimosquitos.com/
  repo/                     # clone de este repo, lo actualiza el deploy
  releases/<UTC>-<sha>/     # una carpeta por deploy
  current -> releases/...   # lo sirve Apache (DocumentRoot)
  config.js                 # credenciales Supabase, fuera de releases
  deploy.log                # log del deploy
```

## Deploy pull-based (producción)

El servidor tiene el repo y se actualiza solo. No se suben artefactos por
rsync desde CI: allá solo se ejecutan los tests.

- `deploy/prod/bootstrap.sh` — setup inicial (dirs, clone por HTTPS, `config.js`).
- `deploy/prod/deploy.sh` — comprueba `main` con `git ls-remote`, y solo si el SHA
  cambió: fetch, build, release nueva, swap atómico, smoke y **rollback automático**
  si el smoke falla; poda las releases viejas.
- `.github/workflows/deploy-prod.yml` — corre los tests y hace de **timbre**: una
  sola orden SSH que ejecuta `deploy.sh` en el servidor (inerte hasta activar la
  variable de repo `PROD_DEPLOY_ENABLED=true`).
- `deploy/prod/patrulla-deploy.{service,timer}` — alternativa sin GitHub Actions:
  sondea `main` cada 15 minutos y despliega si el SHA cambió.

El repo es público, así que el servidor clona por HTTPS y **no hace falta Deploy
Key** (solo si algún día pasa a privado: `REPO_URL=git@github.com:... bootstrap.sh`).

```bash
# en el servidor, una vez
sudo bash /var/www/html/patrulla-antimosquitos.com/repo/deploy/prod/bootstrap.sh

# manual
sudo -u www-data bash /var/www/html/patrulla-antimosquitos.com/repo/deploy/prod/deploy.sh

# o modo sondeo, sin depender de Actions
sudo INSTALL_TIMER=1 bash /var/www/html/patrulla-antimosquitos.com/repo/deploy/prod/bootstrap.sh
```

El deploy es **idempotente**: si `origin/main` ya está publicado, sale sin tocar
nada (de ahí que el timer pueda correr cada 15 minutos sin coste: un `ls-remote`
de unos pocos bytes, ni un objeto descargado).

El vhost de ejemplo está en `deploy/apache.conf.example`. Requiere
`mod_ssl`, `mod_headers`, `mod_deflate`, `mod_expires` y, si se usa HTTP/2,
`mod_http2`. El `DocumentRoot` apunta al symlink `current`; el cambio de release
es atómico y el rollback consiste en volver a apuntar `current` a la release
anterior.

## CI/CD

`deploy/gitlab-ci.example.yml` es un borrador. Cuando el repo esté en GitLab:

1. Copiarlo a `.gitlab-ci.yml`.
2. Crear las variables protegidas `CAPROVER_URL`, `CAPROVER_APP`,
   `CAPROVER_TOKEN`.
3. Asegurar que el runner soporta Docker-in-Docker para construir la imagen.
4. Activar el registry de GitLab y dar de alta las credenciales en CapRover.
5. Proteger `main` y exigir merge request + pipeline.

Etapas: `verify` → `package` → `deploy:staging` → `smoke:staging`. Producción
será un job manual sobre tag, con rsync y symlink.

## Smoke test

```bash
sh deploy/smoke.sh https://patrulla-staging.server.brobert.net
```

Comprueba estado de HTML, health check, manifest, service worker, `config.js`,
`build-info.json`, que la documentación interna devuelve 404 y que están las
cabeceras de seguridad y de caché.

## Notas de seguridad

- Nunca poner `service_role`, password de base de datos ni VAPID privada en
  `config.js`, en el repo ni en la imagen.
- La `anon/publishable key` es pública por diseño; la seguridad real está en RLS.
- La CSP actual permite `'unsafe-inline'` porque la app tiene JS/CSS inline.
  Cuando se modularice, se puede endurecer.
- El bucket `reports` debe ser **privado**. La app muestra las fotos con URLs
  firmadas de 1 hora.
- Staging y producción deberían usar proyectos Supabase distintos.
