# syntax=docker/dockerfile:1

# Cards No Cards production image.
# Multi-stage build. Images are built in CI, not on the EC2 host.

# ---- Base -------------------------------------------------------------------
FROM node:22-bookworm-slim AS base
ENV NODE_ENV=production
WORKDIR /app

# ---- Dependencies -----------------------------------------------------------
FROM base AS deps
# Install all dependencies (including dev) for the build step.
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci

# ---- Builder ----------------------------------------------------------------
FROM base AS builder
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Mock provider keeps the build free of secrets and external calls.
ENV AI_PROVIDER=mock
RUN npm run build

# ---- Runner -----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as an unprivileged user.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Writable, persistent location for the local SQLite database.
RUN mkdir -p /app/local-data && chown -R nextjs:nodejs /app/local-data

# Next.js standalone output bundles only what the server needs.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
