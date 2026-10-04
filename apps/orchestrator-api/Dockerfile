# MovieWatch orchestrator API — Fly.io image.
# Build context is the repo root (fly.toml lives there).
FROM node:22-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@12.9.1 --activate

WORKDIR /app

# Install workspace dependencies first (better layer caching).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY apps/orchestrator-api/package.json apps/orchestrator-api/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/policy-engine/package.json packages/policy-engine/package.json
COPY packages/tmdb/package.json packages/tmdb/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile

# Copy the rest of the source.
COPY . .

# Prisma client + the workspace packages that ship compiled dist.
RUN pnpm --filter @moviewatch/database exec prisma generate \
 && pnpm --filter @moviewatch/tmdb --filter @moviewatch/policy-engine build

# Fly injects PORT; default matches fly.toml's internal_port.
ENV NODE_ENV=production PORT=8080
EXPOSE 8080

# tsx runs the TypeScript sources directly (workspace packages like
# @moviewatch/database ship TS source, not dist).
CMD ["pnpm", "--filter", "@moviewatch/orchestrator-api", "exec", "tsx", "src/index.ts"]
