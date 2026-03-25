# ── Build stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (separate layer — cached unless package.json changes)
COPY package*.json ./
RUN npm ci --only=production=false

# Copy source and compile
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ── Production stage ────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Security: run as non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S validds -u 1001
USER validds

WORKDIR /app

# Copy compiled output and production deps only
COPY --from=builder --chown=validds:nodejs /app/dist ./dist
COPY --from=builder --chown=validds:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=validds:nodejs /app/package.json ./

# Expose app port (Render injects PORT env var — default 3000)
EXPOSE 3000

# Health check — Render also polls /health via HTTP, this is for Docker
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
