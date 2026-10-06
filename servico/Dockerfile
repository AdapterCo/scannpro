# Serviço de pagamento do ScannPro (Node + Firebase Admin SDK).
# A chave do Firebase NÃO entra na imagem: é montada em /run/secrets/firebase-admin.json pelo compose.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORTA=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8787/saude || exit 1
CMD ["node", "src/index.js"]
