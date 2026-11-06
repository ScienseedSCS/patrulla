#!/bin/sh
# Genera /usr/share/nginx/html/config.js al arrancar el contenedor.
# No se hornea en la imagen: así la misma imagen sirve para staging y producción.

set -eu

: "${SUPABASE_URL:?SUPABASE_URL es obligatorio}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY es obligatorio}"

# Quitar barra final para evitar dobles barras en las rutas de Supabase.
SUPABASE_URL="${SUPABASE_URL%/}"

case "$SUPABASE_URL" in
  https://*) ;;
  *)
    echo "ERROR: SUPABASE_URL debe empezar por https://" >&2
    exit 1
    ;;
esac

# La publishable/anon key de Supabase solo usa estos caracteres.
case "$SUPABASE_ANON_KEY" in
  *[!A-Za-z0-9._-]*)
    echo "ERROR: SUPABASE_ANON_KEY contiene caracteres inesperados" >&2
    exit 1
    ;;
esac

umask 022
cat > /usr/share/nginx/html/config.js <<EOF
/* Generado al arrancar el contenedor por deploy/entrypoint-config.sh.
   No editar a mano: se sobrescribe en cada arranque. */
const SUPABASE_URL = '${SUPABASE_URL}';
const SUPABASE_ANON_KEY = '${SUPABASE_ANON_KEY}';
EOF

echo "config.js generado para ${SUPABASE_URL}"
