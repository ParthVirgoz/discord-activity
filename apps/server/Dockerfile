FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

ENV NODE_ENV=production
ENV PORT=2567

EXPOSE 2567

CMD ["node", "build/index.js"]
