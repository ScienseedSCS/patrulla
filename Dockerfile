# syntax=docker/dockerfile:1

# ---------- build estático ----------
FROM node:22-alpine AS build
WORKDIR /app

# El build no necesita dependencias: scripts/build.mjs usa solo Node nativo.
COPY . .
RUN node scripts/build.mjs

# ---------- runtime ----------
FROM nginx:1.27-alpine

# Config propia + generación de config.js en tiempo de arranque.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/entrypoint-config.sh /docker-entrypoint.d/10-patrocinio-config.sh
RUN chmod +x /docker-entrypoint.d/10-patrocinio-config.sh

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
