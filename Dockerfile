# ScannPro: um container só. O serviço Node responde a API (/pagamentos, /webhook/mp, /saude)
# e entrega os arquivos do painel. O Traefik faz o proxy/HTTPS para a porta 8787.
# A chave do Firebase NÃO entra na imagem: é montada em /run/secrets/firebase-admin.json pelo compose.

# 1) build do painel (Vite)
FROM node:22-slim AS painel
WORKDIR /painel
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build

# 2) serviço
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORTA=8787 PASTA_PAINEL=/app/painel INDICES_ARQUIVO=/app/firestore.indexes.json
COPY servico/package.json servico/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY servico/src ./src
COPY firestore.indexes.json ./firestore.indexes.json
COPY --from=painel /painel/dist ./painel
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8787/saude || exit 1
CMD ["node", "src/index.js"]
