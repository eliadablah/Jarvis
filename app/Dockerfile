# Jarvis web app image.
# Stage 1 compiles TypeScript; stage 2 ships only the compiled JavaScript on a
# small base image. The app has no runtime dependencies, so the final image
# has no node_modules at all, and it runs as the unprivileged "node" user.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npm run typecheck && npm test && npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000

# Set by the deploy pipeline so the page shows which commit is running.
ARG APP_VERSION=unknown
ENV APP_VERSION=${APP_VERSION}

COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "dist/server.js"]
