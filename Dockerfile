# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm test && npm run build && npm prune --omit=dev

FROM node:22-alpine
RUN apk add --no-cache su-exec tini
WORKDIR /app
ARG VERSION=dev
ENV NODE_ENV=production \
    PORT=8686 \
    CONFIG_DIR=/config \
    PUID=99 \
    PGID=100 \
    APP_VERSION=${VERSION}
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker/entrypoint.sh /entrypoint.sh
LABEL org.opencontainers.image.title="nowplaying" \
      org.opencontainers.image.description="Spotify + Plex now-playing display and visualizer" \
      org.opencontainers.image.source="https://github.com/ckennard/nowplaying" \
      org.opencontainers.image.version="${VERSION}" \
      net.unraid.docker.icon="https://raw.githubusercontent.com/ckennard/nowplaying/main/web/public/icon.png" \
      net.unraid.docker.webui="http://[IP]:[PORT:8686]/"
EXPOSE 8686
VOLUME /config
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8686/api/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
CMD ["node", "dist/server/index.js"]
