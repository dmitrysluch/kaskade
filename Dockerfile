# Сборка и рантайм разделены: в образ не должны попасть ни vite, ни react,
# ни node_modules сборки — сервер их не использует.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY app ./app
COPY content ./content
RUN npm run build


FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Контент едет в образ целиком: сервер разбирает его при старте и держит
# в памяти. Watcher внутри контейнера тоже работает — правка примонтированной
# заметки долетит до вкладки без пересборки.
COPY tsconfig.json ./
COPY app ./app
COPY content ./content
COPY --from=build /app/dist ./dist

EXPOSE 8080
CMD ["npx", "tsx", "app/server/index.ts"]
