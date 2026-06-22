FROM node:20-alpine AS build
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN apk add --no-cache git
ADD https://api.github.com/repos/boukadaabdelhamid-dot/plattino/commits/main /dev/null
RUN git clone --depth 1 https://github.com/boukadaabdelhamid-dot/plattino.git /repo
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile=false --filter @workspace/erp...
RUN pnpm --filter @workspace/erp run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
RUN npm install -g serve@14
COPY --from=build /repo/artifacts/erp/dist/public /app/public
WORKDIR /app
EXPOSE 3000
CMD ["sh", "-c", "serve -s public -l ${PORT:-3000}"]
