# --- Build stage ---
FROM node:20-alpine AS build
WORKDIR /app

# Web
COPY web/package*.json ./web/
RUN cd web && npm install
COPY web ./web
RUN cd web && npm run build

# Server
COPY server/package*.json ./server/
RUN cd server && npm install
COPY server ./server

# Move web dist into server/public
RUN mkdir -p server/public && cp -r web/dist/* server/public/

# --- Runtime stage ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Copy server app & node_modules
COPY --from=build /app/server /app

EXPOSE 8080
CMD ["node", "src/index.js"]
