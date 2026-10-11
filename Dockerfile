# Builds the frontend, then serves it from the API on a single port.
FROM node:22-bookworm-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server/ ./
COPY --from=web /app/web/dist /app/web/dist
ENV NODE_ENV=production PORT=4000 DATABASE_FILE=/data/scopeline.db
VOLUME /data
EXPOSE 4000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
