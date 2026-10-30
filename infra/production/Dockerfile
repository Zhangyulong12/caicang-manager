ARG NODE_IMAGE=node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da
ARG CADDY_IMAGE=caddy:2-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f
FROM ${NODE_IMAGE} AS node-runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
FROM node-runtime AS build
WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
COPY packages/utils/package.json packages/utils/package.json
RUN pnpm --filter caicang-manager --filter @caicang/api... --filter @caicang/admin-web... install --frozen-lockfile --store-dir /pnpm/store --cache-dir /pnpm/cache
COPY apps/api apps/api
COPY apps/admin-web apps/admin-web
COPY packages packages
COPY infra/production/entry.mjs infra/production/entry.mjs
# Generate never needs a live database. No real build credentials are passed into the image.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build pnpm prisma:generate \
    && pnpm build:shared \
    && pnpm --filter @caicang/api build \
    && pnpm --filter @caicang/admin-web build \
    && pnpm --filter @caicang/api deploy --prod --legacy /deploy/api

FROM build AS migration
ENV NODE_ENV=production
ENTRYPOINT ["node", "infra/production/entry.mjs"]
CMD ["migrate"]

FROM node-runtime AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /deploy/api/node_modules ./node_modules
COPY --from=build --chown=node:node /deploy/api/dist ./dist
COPY --from=build --chown=node:node /deploy/api/package.json ./package.json
COPY --chown=node:node infra/production/entry.mjs ./entry.mjs
USER node
EXPOSE 3000
ENTRYPOINT ["node", "entry.mjs"]
CMD ["api"]

FROM ${CADDY_IMAGE} AS web
COPY --from=build /workspace/apps/admin-web/dist /srv
COPY infra/production/Caddyfile /etc/caddy/Caddyfile
COPY infra/production/routes.caddy /etc/caddy/routes.caddy
COPY infra/production/logging.caddy /etc/caddy/logging.caddy
RUN setcap -r /usr/bin/caddy && chown -R 1000:1000 /data /config
USER 1000:1000
EXPOSE 8080 8443
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
