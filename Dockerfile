# Multi-stage build.
# - Node 22 has a prebuilt better-sqlite3 binary, so no native compile is needed
#   (the full node:22 image also carries build tools as a fallback).
# - Runtime env (WEBHOOK_SECRET, ADMIN_PASSWORD, keys) is injected by the host at
#   run time and is never present during build, so no secrets end up in image layers.

FROM node:22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]
