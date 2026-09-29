FROM node:22-alpine

WORKDIR /app

COPY app/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY app/ ./

CMD ["node", "server.js"]
