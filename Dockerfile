# Production image: API + the four web apps on one origin (OPERATIONS.md §3).
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN corepack enable
# NODE_ENV stays unset here: dev dependencies are needed to build, and the Vite configs
# refuse a non-production NODE_ENV.
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production \
    SERVE_WEB=true \
    HOST=0.0.0.0 \
    LOG_PRETTY=false
COPY --from=build /app /app
RUN mkdir -p /app/var/uploads && chown -R node:node /app/var
USER node
EXPOSE 3000
# Sets up database roles, migrates, seeds reference data, then starts the API.
CMD ["node", "--enable-source-maps", "apps/api/dist/database/cli/hosted-start.js"]
