#!/usr/bin/env bash
# Deploy pull-based de Patrulla Antimosquitos en el servidor de producción.
#
# Se ejecuta EN EL SERVIDOR, como www-data (dueño de APP_ROOT).
# Lo dispara GitHub Actions por SSH, o el timer systemd (modo sondeo).
#
# Qué hace, en orden:
#   1. git ls-remote de origin/main (si no hay cambios, sale sin descargar nada)
#      y solo entonces git fetch
#   2. node scripts/build.mjs  ->  dist/
#   3. copia APP_ROOT/config.js dentro de dist/ (las credenciales no viven en el repo)
#   4. rsync a releases/<UTC>-<sha>/
#   5. swap atómico del symlink current
#   6. smoke test; si falla, rollback al symlink anterior
#   7. borra releases viejas (KEEP)
#
# Uso:
#   bash deploy/prod/deploy.sh            # normal
#   FORCE=1 bash deploy/prod/deploy.sh    # redeploy aunque el sha no cambie
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/var/www/html/patrulla-antimosquitos.com}"
REPO_DIR="$APP_ROOT/repo"
RELEASES="$APP_ROOT/releases"
CURRENT="$APP_ROOT/current"
CONFIG="$APP_ROOT/config.js"
LOG="$APP_ROOT/deploy.log"
LOCK="$APP_ROOT/.deploy.lock"

BRANCH="${BRANCH:-main}"
KEEP="${KEEP:-5}"
SMOKE_URL="${SMOKE_URL:-https://patrulla-antimosquitos.com}"
NODE_BIN="${NODE_BIN:-node}"
FORCE="${FORCE:-0}"

export PATH="/usr/local/bin:/usr/bin:/bin"
export GIT_TERMINAL_PROMPT=0

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG"; }
die() { log "ERROR: $*"; exit 1; }

# --- 0. candado: nunca dos deploys a la vez -------------------------------
exec 9>"$LOCK"
flock -w 300 9 || die "timeout esperando al deploy en curso"

# --- log acotado ---------------------------------------------------------
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 5242880 ]; then
  tail -c 1048576 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

# --- precondiciones ------------------------------------------------------
[ -d "$REPO_DIR/.git" ] || die "no hay repo en $REPO_DIR (ejecuta deploy/prod/bootstrap.sh)"
[ -f "$REPO_DIR/scripts/build.mjs" ] || die "$BRANCH no tiene scripts/build.mjs: mergea la capa de deploy a main primero"
[ -f "$REPO_DIR/deploy/smoke.sh" ] || die "$BRANCH no tiene deploy/smoke.sh"
[ -f "$CONFIG" ] || die "falta $CONFIG (credenciales Supabase de producción)"
command -v "$NODE_BIN" >/dev/null || die "no encuentro $NODE_BIN en el servidor"
command -v rsync >/dev/null || die "no encuentro rsync"
command -v curl >/dev/null || die "no encuentro curl (lo usa el smoke test)"

# --- 1. ver si hay algo nuevo (ls-remote: no baja objetos) ----------------
log "comprobando origin/$BRANCH"
REMOTE_REV="$(git -C "$REPO_DIR" ls-remote origin "refs/heads/$BRANCH" | cut -f1)"
[ -n "$REMOTE_REV" ] || die "no pude leer origin/$BRANCH"

DEPLOYED_REV="$(cat "$CURRENT/.deployed-sha" 2>/dev/null || true)"
if [ "$REMOTE_REV" = "$DEPLOYED_REV" ] && [ "$FORCE" != "1" ]; then
  log "sin cambios: ${REMOTE_REV:0:7} ya está publicado"
  exit 0
fi

log "fetch origin/$BRANCH"
git -C "$REPO_DIR" fetch --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" \
  >>"$LOG" 2>&1 || die "git fetch falló"
TARGET_REV="$(git -C "$REPO_DIR" rev-parse "refs/remotes/origin/$BRANCH")"
SHORT="$(git -C "$REPO_DIR" rev-parse --short "$TARGET_REV")"
[ "$TARGET_REV" = "$REMOTE_REV" ] || die "el remoto cambió durante el fetch; reintenta"

git -C "$REPO_DIR" checkout -q -f -B "$BRANCH" "$TARGET_REV" || die "git checkout falló"

# --- 2. build ------------------------------------------------------------
log "build con $("$NODE_BIN" --version)"
( cd "$REPO_DIR" && GITHUB_SHA="$TARGET_REV" GITHUB_REF_NAME="$BRANCH" \
    "$NODE_BIN" scripts/build.mjs ) >>"$LOG" 2>&1 || die "el build falló (ver $LOG)"

DIST="$REPO_DIR/dist"
[ -f "$DIST/index.html" ] || die "dist/ no tiene index.html"
[ -f "$DIST/healthz" ] || die "dist/ no tiene healthz"

# --- 3. config.js: fuera del repo, dentro de la release ------------------
grep -q "SUPABASE_URL" "$CONFIG" || die "$CONFIG no parece un config.js válido"
cp -f "$CONFIG" "$DIST/config.js"

# --- 4. release ----------------------------------------------------------
REL_NAME="$(date -u +%Y%m%dT%H%M%S)-$SHORT"
REL_DIR="$RELEASES/$REL_NAME"
mkdir -p "$REL_DIR"
rsync -a --delete --chmod=D755,F644 "$DIST/" "$REL_DIR/" >>"$LOG" 2>&1 || die "rsync falló"
printf '%s\n' "$TARGET_REV" > "$REL_DIR/.deployed-sha"
printf '%s\n' "$(date -u +%FT%TZ)" > "$REL_DIR/.deployed-at"
log "release $REL_NAME ($(du -sh "$REL_DIR" | cut -f1))"

# --- 5. swap atómico -----------------------------------------------------
PREV="$(readlink -f "$CURRENT" 2>/dev/null || true)"
ln -s "$REL_DIR" "$APP_ROOT/.current.tmp" && mv -T "$APP_ROOT/.current.tmp" "$CURRENT" \
  || die "no pude cambiar el symlink current"
log "current -> $REL_NAME (anterior: ${PREV:-ninguna})"

# --- 6. smoke + rollback -------------------------------------------------
sleep 1
if ! sh "$REPO_DIR/deploy/smoke.sh" "$SMOKE_URL" >>"$LOG" 2>&1; then
  log "SMOKE FALLÓ"
  tail -20 "$LOG" >&2 || true
  if [ -n "${PREV:-}" ] && [ -d "${PREV:-/nonexistent}" ]; then
    ln -s "$PREV" "$APP_ROOT/.current.tmp" && mv -T "$APP_ROOT/.current.tmp" "$CURRENT"
    log "rollback a $(basename "$PREV")"
  else
    log "no hay release anterior; current queda en $REL_NAME"
  fi
  exit 1
fi
log "smoke OK"

# --- 7. prune ------------------------------------------------------------
PRUNED=0
while IFS= read -r old; do
  [ -n "$old" ] || continue
  [ "$(readlink -f "$old")" = "$(readlink -f "$CURRENT")" ] && continue
  log "borrando release vieja $(basename "$old")"
  rm -rf "$old"
  PRUNED=$((PRUNED + 1))
done < <(ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +$((KEEP + 1)))

log "deploy OK: $SHORT (releases: $(find "$RELEASES" -maxdepth 1 -mindepth 1 -type d | wc -l), borradas: $PRUNED)"
