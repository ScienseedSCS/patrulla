# Deploy

Estado actual de producción y cómo operarlo. Si sólo vas a leer una línea:
**un push a `main` publica en https://patrulla-antimosquitos.com**.

## Producción

| | |
|---|---|
| URL | https://patrulla-antimosquitos.com (sólo apex, sin `www`) |
| Servidor | Ubuntu 24.04 + Apache, `3.151.209.104` |
| Raíz | `/var/www/html/patrulla-antimosquitos.com` |
| Sirve | `current` (symlink) → `releases/<UTC>-<sha>/` |

Contenido de la raíz en el servidor:

```
repo/           clone del repo (lo actualiza el deploy, se ejecuta git aquí)
releases/       una carpeta por deploy; se podan las > 5
current         symlink a la release activa; es el DocumentRoot de Apache
config.js       credenciales Supabase de producción (fuera de releases)
deploy.log      log de cada deploy
```

Apache: vhosts `patrulla-antimosquitos.com.conf` (:80, redirige a HTTPS) y
`patrulla-antimosquitos.com-ssl.conf` en `/etc/apache2/sites-available/`.
TLS con Let's Encrypt y renovación automática (`certbot renew --dry-run` para probar).

## Cómo se despliega

```
push a main
  └─ GitHub Actions .github/workflows/deploy-prod.yml
       1. bun test                                   (si falla, no hay deploy)
       2. ssh www-data@servidor → deploy/prod/deploy.sh
       3. verifica https://patrulla-antimosquitos.com
```

El **deploy ocurre en el servidor**, no en el runner: no se suben artefactos.
`deploy.sh` hace, en el servidor:

```
git ls-remote  →  ¿cambió el SHA de main?  →  no: sale sin tocar nada
                                          →  sí: git fetch + node scripts/build.mjs
                                                 → releases/<UTC>-<sha>/
                                                 → swap atómico de current
                                                 → config.js desde $RAÍZ/config.js
                                                 → smoke test; si falla, rollback
                                                 → poda de releases viejas
```

No reinicia Apache: sólo cambia el symlink.

**Red de seguridad:** el mismo script corre por un timer systemd cada 15 minutos
(`patrulla-deploy.timer`), así que un push acaba publicado aunque Actions esté
caído. Es idempotente y usa `flock`: si se solapan, uno espera al otro.

## Staging

| | |
|---|---|
| URL | https://patrulla-staging.server.brobert.net |
| Dónde | CapRover (máquina personal), app `patrulla-staging` |
| Sirve | imagen Docker con el `Dockerfile` de la raíz (nginx) |
| Supabase | proyecto **de staging**, nunca el de producción |

`config.js` no va en la imagen: el contenedor lo genera al arrancar desde
`SUPABASE_URL` y `SUPABASE_ANON_KEY` (*App Settings → Environment Variables*).

Hoy se despliega a mano; el objetivo es que CapRover construya desde `main` en
cada push (ver `PLAN.md`, Fase 3). El detalle de build y Docker está en
[`deploy/README.md`](deploy/README.md).

## Repo y ramas

- `origin` → `https://github.com/ScienseedSCS/patrulla.git`, **público**.
  El servidor lo clona anónimamente por HTTPS: no hay claves para leer el código.
- `main` es lo único que se despliega.
- `deploy/caprover-staging` es trabajo de staging (CapRover) y **no** se despliega.

## Operar

```bash
APP=/var/www/html/patrulla-antimosquitos.com

readlink -f "$APP/current"          # qué release está publicada
ls -1 "$APP/releases"               # histórico (máx. 5)
tail -30 "$APP/deploy.log"          # qué pasó en el último deploy
curl -s https://patrulla-antimosquitos.com/build-info.json   # commit + fecha publicados
sh "$APP/repo/deploy/smoke.sh" https://patrulla-antimosquitos.com
```

Deploy manual y forzado (sin esperar al push ni al timer):

```bash
sudo -u www-data bash "$APP/repo/deploy/prod/deploy.sh"
sudo -u www-data env FORCE=1 bash "$APP/repo/deploy/prod/deploy.sh"
```

Rollback manual (segundos, sin build):

```bash
ls -1dt "$APP"/releases/*/ | head -3
sudo -u www-data ln -s "$APP/releases/<anterior>" "$APP/.current.tmp"
sudo -u www-data mv -T "$APP/.current.tmp" "$APP/current"
```

CI en GitHub:

```bash
gh run list --workflow deploy-prod --limit 5
gh run view <id> --log | tail -40
```

## Credenciales y accesos

- `$APP/config.js` es la **única** fuente de credenciales Supabase en producción.
  Se copia a cada release en el build. La `anon/publishable key` es pública por
  diseño; lo que protege es RLS. Nunca metas `service_role` ahí.
- GitHub → secret `PROD_SSH_KEY` (clave privada que usa el runner) y variable
  `PROD_DEPLOY_ENABLED=true` (interruptor del job de deploy).
- Servidor → `/var/www/.ssh/authorized_keys` sólo tiene la pública de esa clave,
  y `sshd` aplica `ForceCommand`: esa clave **sólo** puede ejecutar `deploy.sh`,
  no abre shell.
- El usuario del deploy es `www-data` (dueño de la raíz). Si cambias el repo a
  privado, hay que generar una Deploy Key y cambiar `REPO_URL`
  (`REPO_URL=git@github.com:... bootstrap.sh`).

## Ficheros que importan

| Fichero | Qué es |
|---|---|
| `deploy/prod/deploy.sh` | el deploy completo, corre en el servidor |
| `deploy/prod/bootstrap.sh` | setup inicial del servidor (idempotente) |
| `deploy/prod/patrulla-deploy.{service,timer}` | red de seguridad por timer |
| `.github/workflows/deploy-prod.yml` | tests + timbre SSH |
| `deploy/smoke.sh` | smoke test (también usable a mano) |
| `scripts/build.mjs` | genera `dist/` con lo que se publica |
