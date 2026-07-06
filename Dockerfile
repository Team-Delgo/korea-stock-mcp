# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app

COPY tsconfig.json ./
COPY src ./src
COPY data ./data
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV MCP_ENDPOINT=/mcp
ENV DOTENV_CONFIG_PATH=.env.production

ARG RUNTIME_ENV_CACHE_BUST=unset
ARG REQUIRE_RUNTIME_ENV=false
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/data ./data
RUN --mount=type=secret,id=runtime_env,required=false \
  echo "runtime env cache bust: ${RUNTIME_ENV_CACHE_BUST}" >/dev/null && \
  if [ "${REQUIRE_RUNTIME_ENV}" = "true" ] && [ ! -f /run/secrets/runtime_env ]; then \
    echo "runtime_env secret is required for this build" >&2; exit 1; \
  fi && \
  if [ -f /run/secrets/runtime_env ]; then \
    cp /run/secrets/runtime_env ./.env.production && chown node:node ./.env.production && chmod 600 ./.env.production; \
  fi && \
  if [ "${REQUIRE_RUNTIME_ENV}" = "true" ]; then \
    for key in KIS_APP_KEY KIS_APP_SECRET KIS_ENV DART_API_KEY; do \
      grep -q "^${key}=" ./.env.production || { echo ".env.production is missing ${key}=" >&2; exit 1; }; \
    done; \
  fi

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
