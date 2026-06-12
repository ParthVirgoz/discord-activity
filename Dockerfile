FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/

RUN npm ci

COPY apps/server apps/server

RUN npm run build -w server

FROM node:20-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/

RUN npm ci --omit=dev

COPY --from=build /app/apps/server/build apps/server/build

ENV NODE_ENV=production
ENV PORT=2567

WORKDIR /app/apps/server
EXPOSE 2567

CMD ["node", "build/index.js"]
