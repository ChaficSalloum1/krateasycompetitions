FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY packages ./packages
COPY apps/compiler-web ./apps/compiler-web
RUN npm ci
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=4173 HOST=0.0.0.0 NODE_OPTIONS=--disable-proto=throw
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/packages ./packages
COPY --chown=node:node --from=build /app/apps/compiler-web/dist ./apps/compiler-web/dist
EXPOSE 4173
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 CMD wget -q -O - http://127.0.0.1:4173/health/ready || exit 1
USER node
CMD ["node", "apps/compiler-web/dist/src/production-host.js"]
