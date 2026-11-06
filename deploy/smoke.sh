#!/bin/sh
# Smoke test de un deploy estático de Patrulla.
# Uso: deploy/smoke.sh https://patrulla-staging.server.brobert.net
set -eu

BASE="${1:-}"
if [ -z "$BASE" ]; then
  echo "Uso: $0 https://patrulla-staging.server.brobert.net" >&2
  exit 1
fi
BASE="${BASE%/}"

check_status() {
  path="$1"
  expected="$2"
  code="$(curl -sS -o /dev/null -w '%{http_code}' -L "$BASE$path")"
  if [ "$code" != "$expected" ]; then
    echo "FALLO $path: HTTP $code (esperado $expected)" >&2
    exit 1
  fi
  echo "ok   $path -> $code"
}

check_header() {
  path="$1"
  header="$2"
  if ! curl -sSI -L "$BASE$path" | tr -d '\r' | grep -qi "^$header:"; then
    echo "FALLO $path: falta la cabecera $header" >&2
    exit 1
  fi
  echo "ok   $path -> $header"
}

check_cache() {
  path="$1"
  pattern="$2"
  value="$(curl -sSI -L "$BASE$path" | tr -d '\r' | grep -i '^cache-control:' | head -1 || true)"
  echo "$value" | grep -qi "$pattern" || {
    echo "FALLO $path: Cache-Control no contiene '$pattern' ($value)" >&2
    exit 1
  }
  echo "ok   $path -> Cache-Control $pattern"
}

echo "Smoke test: $BASE"
check_status /                    200
check_status /healthz             200
check_status /manifest.webmanifest 200
check_status /sw.js               200
check_status /config.js           200
check_status /build-info.json     200
check_status /admin.html          200
check_status /admin-reportes.html 200
check_status /README.md           404
check_status /ADMIN.md            404
check_status /caso1.png           404

check_header / Content-Security-Policy
check_header / X-Content-Type-Options
check_header / Referrer-Policy
check_header / Permissions-Policy
check_header / Strict-Transport-Security
check_cache  /config.js no-cache
check_cache  /icon-192.png max-age

echo "Smoke test OK"
