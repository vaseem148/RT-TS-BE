# syntax=docker/dockerfile:1

# ---------- deps: production node_modules only ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# mongodb-memory-server is a devDependency and is imported lazily, so the
# production image never needs it (and never downloads a mongod binary).
RUN npm ci --omit=dev && npm cache clean --force

# ---------- runner ----------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

RUN apk add --no-cache curl tini

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

# Mount point for the uploads volume. Created here so the container also
# starts correctly when no volume is attached.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-5000}/api/health" || exit 1

# tini reaps zombies and forwards SIGTERM so the graceful shutdown in
# server.js actually runs.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
