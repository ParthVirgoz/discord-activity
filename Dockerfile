# Single-stage build — reliable for Railway (avoids broken prod node_modules copy)
FROM node:20-bookworm

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/

RUN npm ci

COPY apps/server apps/server

RUN npm run build -w server

ENV NODE_ENV=production

WORKDIR /app/apps/server

# Railway injects PORT at runtime — do not hardcode
EXPOSE 2567

CMD ["node", "build/index.js"]
