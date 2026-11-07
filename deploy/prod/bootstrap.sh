#!/usr/bin/env bash
# Setup inicial (una sola vez) del servidor de producción.
#
# Ejecutar en el servidor con sudo:
#   sudo bash /var/www/html/patrulla-antimosquitos.com/repo/deploy/prod/bootstrap.sh
#
# Es idempotente: se puede volver a ejecutar sin romper nada.
# Hace:
#   - crea APP_ROOT/{repo,releases} y da la propiedad a www-data
#   - clona el repo si no existe (HTTPS; es público y de solo lectura)
#   - crea APP_ROOT/config.js a partir del del repo (editable después)
#   - (opcional) instala el timer systemd de sondeo
#
# Con REPO_URL=git@github.com:... genera además una Deploy Key, pero no es
# necesario mientras el repo sea público.
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/var/www/html/patrulla-antimosquitos.com}"
REPO_URL="${REPO_URL:-https://github.com/ScienseedSCS/patrulla.git}"
BRANCH="${BRANCH:-main}"
DEPLOY_USER="${DEPLOY_USER:-www-data}"
INSTALL_TIMER="${INSTALL_TIMER:-0}"

KEY="$APP_ROOT/.ssh/id_ed25519_github"

say() { printf '\n== %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta con sudo." >&2; exit 1; }
id "$DEPLOY_USER" >/dev/null 2>&1 || { echo "No existe el usuario $DEPLOY_USER" >&2; exit 1; }

# SSH solo si el repo se clona por git@ (privado). Público -> HTTPS, sin claves.
case "$REPO_URL" in
  git@*|ssh://*) USE_SSH=1 ;;
  *)             USE_SSH=0 ;;
esac

say "1/5 Directorios en $APP_ROOT"
# APP_ROOT lo posee www-data: el deploy escribe ahí (lock, symlink, releases, log).
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_ROOT"
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_ROOT/releases"

if [ "$USE_SSH" = "1" ]; then
  say "2/5 Clave de deploy (repo por SSH)"
  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_ROOT/.ssh"
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /dev/null "$APP_ROOT/.ssh/known_hosts"
  if [ ! -f "$KEY" ]; then
    sudo -u "$DEPLOY_USER" ssh-keygen -t ed25519 -N '' \
      -C "patrulla-prod@$(hostname)" -f "$KEY" >/dev/null
    echo "Clave creada: $KEY"
  else
    echo "Ya existe: $KEY"
  fi
  chown "$DEPLOY_USER:$DEPLOY_USER" "$KEY" "$KEY.pub"
  chmod 600 "$KEY"
  SSH_CMD="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$APP_ROOT/.ssh/known_hosts"
else
  say "2/5 Sin claves (repo público por HTTPS)"
  SSH_CMD=""
fi

say "3/5 Clonar el repo"
if [ ! -d "$APP_ROOT/repo/.git" ]; then
  if [ -n "$SSH_CMD" ]; then
    sudo -u "$DEPLOY_USER" env GIT_SSH_COMMAND="$SSH_CMD" \
      git clone --branch "$BRANCH" "$REPO_URL" "$APP_ROOT/repo"
  else
    sudo -u "$DEPLOY_USER" git clone --branch "$BRANCH" "$REPO_URL" "$APP_ROOT/repo"
  fi
else
  echo "Ya existe: $APP_ROOT/repo"
fi

if [ -d "$APP_ROOT/repo/.git" ]; then
  sudo -u "$DEPLOY_USER" git -C "$APP_ROOT/repo" remote set-url origin "$REPO_URL"
  if [ -n "$SSH_CMD" ]; then
    sudo -u "$DEPLOY_USER" git -C "$APP_ROOT/repo" config core.sshCommand "$SSH_CMD"
  fi
  sudo -u "$DEPLOY_USER" git -C "$APP_ROOT/repo" config advice.detachedHead false
fi

say "4/5 config.js de producción"
if [ ! -f "$APP_ROOT/config.js" ]; then
  if [ -f "$APP_ROOT/repo/config.js" ]; then
    install -m 640 -o "$DEPLOY_USER" -g "$DEPLOY_USER" \
      "$APP_ROOT/repo/config.js" "$APP_ROOT/config.js"
    echo "Creado $APP_ROOT/config.js a partir del repo."
    echo "Si producción usa otro proyecto Supabase, edítalo ahora."
  else
    echo "AVISO: no hay $APP_ROOT/config.js. Créalo antes del primer deploy."
  fi
else
  echo "Ya existe: $APP_ROOT/config.js"
fi

say "5/5 Timer de sondeo (opcional)"
if [ "$INSTALL_TIMER" = "1" ]; then
  install -m 644 "$APP_ROOT/repo/deploy/prod/patrulla-deploy.service" /etc/systemd/system/
  install -m 644 "$APP_ROOT/repo/deploy/prod/patrulla-deploy.timer" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now patrulla-deploy.timer
  systemctl list-timers patrulla-deploy.timer --no-pager || true
else
  echo "No instalado. Para activarlo:"
  echo "  sudo INSTALL_TIMER=1 bash $APP_ROOT/repo/deploy/prod/bootstrap.sh"
fi

cat <<EOF

------------------------------------------------------------------
Pendiente (una vez, manual):

1. Primer deploy:

   sudo -u $DEPLOY_USER bash $APP_ROOT/repo/deploy/prod/deploy.sh

2. Estado y logs:

   tail -f $APP_ROOT/deploy.log
   ls -la $APP_ROOT/releases
   readlink -f $APP_ROOT/current
------------------------------------------------------------------
EOF

if [ "$USE_SSH" = "1" ]; then
  cat <<EOF

Deploy Key pendiente de añadir en GitHub
(Settings -> Deploy keys -> Add deploy key, SIN write access):

$(cat "$KEY.pub" 2>/dev/null || echo "(clave no disponible)")
EOF
fi
