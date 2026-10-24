# Servidor de salas (WebSocket) do Fliperama — roda no Fly.io.
# As páginas (galeria, jogos, app do controle) ficam na Vercel.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
