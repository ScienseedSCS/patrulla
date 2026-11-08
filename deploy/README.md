# Deploy

Infraestructura de despliegue. La app es estática (HTML + CSS + JS + Supabase):
no hay backend propio ni build de aplicación.

**Producción**: ver [`../DEPLOY.md`](../DEPLOY.md). No hace falta nada de esta
carpeta para entenderla; los scripts que usa producción están en `prod/` y se
describen allí.

## Build local

```bash
node scripts/build.mjs                 # genera dist/ (sin config.js)
COPY_CONFIG=1 node scripts/build.mjs   # incluye el config.js del repo, solo local
npx serve dist
```

`scripts/build.mjs` es la lista de lo que se publica y lo que no. Léelo ahí; no
lo dupliques en documentación.

## Docker local

```bash
docker build -t patrulla:local .

docker run --rm -p 8080:80 \
  -e SUPABASE_URL="https://<ref>.supabase.co" \
  -e SUPABASE_ANON_KEY="<publishable-key>" \
  patrulla:local
```

El contenedor genera `config.js` al arrancar a partir de esas dos variables y
falla rápido si faltan. La misma imagen sirve para staging y producción.

## Staging (CapRover)

`https://patrulla-staging.server.brobert.net`, app `patrulla-staging` en CapRover.
Usa el `Dockerfile` y el `captain-definition` de la raíz del repo.

En *App Settings → Environment Variables*:

- `SUPABASE_URL` — del proyecto Supabase **de staging**, no el de producción.
- `SUPABASE_ANON_KEY` — la publishable key de ese proyecto.

Sin ellas el contenedor no arranca. Además, en Supabase, *Auth → Site URL* y
*Redirect URLs* deben incluir el dominio de staging, o el login falla.

Hoy se despliega a mano (`caprover deploy`); el objetivo es que CapRover construya
desde `main` en cada push. Ver la Fase 3 de [`../PLAN.md`](../PLAN.md).

## Smoke test

```bash
sh deploy/smoke.sh https://patrulla-staging.server.brobert.net
```

Sirve para cualquier entorno; comprueba estado, cabeceras, caché y que no se
sirve documentación interna.

## Seguridad

- Nunca `service_role`, contraseña de base de datos ni la VAPID privada en
  `config.js`, en el repo ni en la imagen. La `anon/publishable key` es pública
  por diseño: lo que protege los datos es RLS.
- El bucket `reports` es privado; la app muestra las fotos con URLs firmadas.
- Staging y producción deben usar proyectos Supabase distintos.
- La CSP permite `'unsafe-inline'` porque la app tiene JS y CSS inline. Se puede
  endurecer cuando se modularice.
