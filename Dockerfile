# syntax=docker/dockerfile:1.7

FROM python:3.14-slim AS api

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/services/api/src

WORKDIR /app
COPY services/api/pyproject.toml services/api/pyproject.toml
COPY services/api/src services/api/src
COPY services/api/alembic.ini services/api/alembic.ini
COPY services/api/migrations services/api/migrations
RUN pip install --no-cache-dir ./services/api \
    && useradd --create-home --uid 10001 rationexa \
    && mkdir -p /data/artifacts \
    && chown -R rationexa:rationexa /data

USER rationexa
EXPOSE 8000
CMD ["uvicorn", "rationexa_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]

FROM node:26.8-alpine AS web-builder

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
COPY packages/api-contract packages/api-contract
ARG NEXT_PUBLIC_API_URL=/api/backend
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @rationexa/web build

FROM node:26.8-alpine AS web

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
WORKDIR /app
RUN corepack enable
COPY --from=web-builder --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@rationexa/web", "start"]
