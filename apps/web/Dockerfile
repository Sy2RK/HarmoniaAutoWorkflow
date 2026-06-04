FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN corepack enable && pnpm install --filter @harmonia/web... --frozen-lockfile=false

FROM node:24-alpine
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
EXPOSE 5173
CMD ["pnpm", "--filter", "@harmonia/web", "dev"]
