FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY packages ./packages
COPY apps/compiler-web ./apps/compiler-web
RUN npm ci
RUN npm run build
RUN npm prune --omit=dev

# CP-SAT deployment mode A: the pinned OR-Tools worker ships in the runtime image. OR-Tools publishes
# only glibc (manylinux) wheels, so the runtime is Debian rather than Alpine.
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4173 HOST=0.0.0.0 NODE_OPTIONS=--disable-proto=throw \
    TOURNAMENT_OS_CP_SAT_PYTHON=/opt/cp-sat/bin/python
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*
COPY packages/competition-engine/solver/requirements-cp-sat.txt packages/competition-engine/solver/constraints-cp-sat.txt /tmp/cp-sat/
RUN python3 -m venv /opt/cp-sat \
 && /opt/cp-sat/bin/pip install --no-cache-dir -r /tmp/cp-sat/requirements-cp-sat.txt -c /tmp/cp-sat/constraints-cp-sat.txt \
 && rm -rf /tmp/cp-sat
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/packages ./packages
COPY --chown=node:node --from=build /app/apps/compiler-web/dist ./apps/compiler-web/dist
EXPOSE 4173
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:4173/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
USER node
CMD ["node", "apps/compiler-web/dist/src/production-host.js"]
