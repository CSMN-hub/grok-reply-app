# syntax=docker/dockerfile:1

# ---------- build stage ----------
FROM node:20-alpine AS build
WORKDIR /app

# Web (frontend) deps + build
COPY web/package*.json ./web/
RUN npm --prefix web ci
COPY web ./web
RUN npm --prefix web run build

# Server (backend) deps
COPY server/package*.json ./server/
RUN npm --prefix server ci
COPY server ./server

# Put the frontend build into server/public
RUN mkdir -p server/public && cp -r web/dist/* server/public/

# ---------- run stage ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# copy server app (including node_modules & public)
COPY --from=build /app/server /app/server

EXPOSE 8080
CMD ["node", "server/src/index.js"]
