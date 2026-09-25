# Build from the repository root:
#   docker build -f examples/support-desk/Dockerfile -t nexo-support-desk .
#   docker run -p 4000:4000 -e JWT_SECRET=<32+ byte secret> -v nexo-data:/app/data nexo-support-desk

# ---- Build: install, compile the example and the workspace packages it uses ----
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages ./packages
COPY examples/support-desk ./examples/support-desk

RUN pnpm install --frozen-lockfile --filter "@nexo/example-support-desk..."
RUN pnpm --filter "@nexo/example-support-desk^..." build \
 && pnpm --filter @nexo/example-support-desk build
# Keep the compiled output, reinstall production dependencies only.
# (pnpm deploy would need inject-workspace-packages=true, which changes the lockfile.)
RUN find . -name node_modules -type d -prune -exec rm -rf {} + \
 && pnpm install --frozen-lockfile --prod --filter "@nexo/example-support-desk..."

# ---- Runtime ----
FROM node:22-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    DATA_DIR=/app/data
WORKDIR /app

COPY --from=build --chown=node:node /repo ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
WORKDIR /app/examples/support-desk

VOLUME ["/app/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

CMD ["node", "dist/index.js"]
