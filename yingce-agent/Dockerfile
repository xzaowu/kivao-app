# syntax=docker/dockerfile:1.7

FROM node:22.19-alpine

RUN apk add --no-cache ca-certificates wget \
    && addgroup -S app \
    && adduser -S app -G app

WORKDIR /app
ARG BUILD_VERSION
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME=unknown
RUN printf '{"version":"%s","commit":"%s","buildTime":"%s"}\n' "$BUILD_VERSION" "$BUILD_COMMIT" "$BUILD_TIME" > /app/build-info.json
COPY backend/agent-runtime/pi/package.json backend/agent-runtime/pi/package-lock.json /app/agent-runtime/
RUN npm ci --omit=dev --ignore-scripts --prefix /app/agent-runtime
COPY backend/agent-runtime/pi/agent-runtime.mjs /app/agent-runtime/agent-runtime.mjs
COPY yingce-agent/server.mjs /app/server.mjs

ENV NODE_ENV=production
USER app
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8081/healthz >/dev/null || exit 1
CMD ["node", "server.mjs"]
