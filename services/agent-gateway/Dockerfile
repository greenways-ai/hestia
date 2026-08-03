FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /opt/hestia

COPY services/agent-gateway/package.json services/agent-gateway/package-lock.json ./services/agent-gateway/
RUN cd services/agent-gateway \
    && npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY services/agent-gateway/src ./services/agent-gateway/src
COPY browser/src ./browser/src

WORKDIR /opt/hestia/services/agent-gateway
EXPOSE 8787
CMD ["node", "src/server.mjs"]
