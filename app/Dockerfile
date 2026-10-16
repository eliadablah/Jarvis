# syntax=docker/dockerfile:1
# Jarvis web app image.
# Stage 1 compiles TypeScript, runs the tests, and gathers the self-hosted
# voice engine files. Stage 2 fetches the ai-visualizer faces. Stage 3 ships
# the compiled app, the faces, and Claude Code (the brain), running as the
# unprivileged "node" user. Debian slim instead of Alpine because Claude
# Code ships a native binary built for glibc.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.client.json tsconfig.worker.json ./
COPY src ./src
COPY client ./client
COPY public ./public
COPY scripts ./scripts
COPY test ./test
RUN npm run typecheck && npm test && npm run build

# The faces: jaredrhod/ai-visualizer (AGPL-3.0), pinned to the same commit
# as my local install. Only the browser files are kept; its Python server
# isn't needed because the app feeds the faces itself.
FROM scratch AS visualizer
ADD https://github.com/jaredrhod/ai-visualizer.git#6921e1d4b06bdd4a34c5264882d5257c4d5f70fd /src

FROM node:24-bookworm-slim

# Claude Code, pinned to the release Anthropic marks "stable". Upgrades are
# a deliberate commit, never automatic inside a running container.
ARG CLAUDE_CODE_VERSION=2.1.292
ARG CODEX_VERSION=0.163.0
RUN npm install -g --no-audit --no-fund "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
  && npm install -g --no-audit --no-fund "@openai/codex@${CODEX_VERSION}" \
  && npm cache clean --force

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    VISUALIZER_DIR=/app/visualizer \
    JARVIS_PERSONA_PATH=/app/persona/jarvis.md \
    JARVIS_WORKDIR=/home/node/workspace \
    CLAUDE_CONFIG_DIR=/home/node/.claude \
    DISABLE_AUTOUPDATER=1 \
    DISABLE_TELEMETRY=1 \
    DISABLE_ERROR_REPORTING=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

# Set by the deploy pipeline so the page shows which commit is running.
ARG APP_VERSION=unknown
ENV APP_VERSION=${APP_VERSION}

COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=visualizer /src/core.js /src/LICENSE ./visualizer/
COPY --from=visualizer /src/faces ./visualizer/faces
COPY --from=visualizer /src/assets ./visualizer/assets
COPY persona ./persona

# Claude Code keeps its conversation history under the home folder, which
# the server mounts as a volume so conversations survive restarts.
RUN mkdir -p /home/node/workspace /home/node/.claude && chown -R node:node /home/node

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
