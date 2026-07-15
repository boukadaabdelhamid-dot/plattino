FROM node:20-alpine AS build
ARG RAILWAY_GIT_COMMIT_SHA
RUN apk add --no-cache git
RUN git clone --depth 1 https://github.com/boukadaabdelhamid-dot/plattino.git /repo
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate
RUN pnpm install --frozen-lockfile=false --filter @workspace/api-server... --filter @workspace/db
ENV NODE_ENV=production
RUN pnpm --filter @workspace/api-server run build

FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate
ENV NODE_ENV=production
COPY --from=build /repo /app
WORKDIR /app/artifacts/api-server
EXPOSE 3000
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
