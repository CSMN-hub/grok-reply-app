# syntax=docker/dockerfile:1

# ---------- build stage ----------
FROM node:20-alpine AS build
WORKDIR /app

# Copy & install web deps
COPY web/package*.json ./web/
RUN if [ -f web/package-lock.json ]; then \
      npm --prefix web ci; \
    else \
      npm --prefix web install --no-audit --no-fund; \
    fi

# Build web
COPY web ./web
RUN npm --prefix web run build

# Copy & install server deps
COPY server/package*.json ./server/
RUN if [ -f server/package-lock.json ]; then \
      npm --prefix server ci; \
    else \
      npm --prefix server install --no-audit --no-fund; \
    fi

# Copy server source
COPY server ./server

# Place built web into server/public
RUN mkdir -p server/public && cp -r web/dist/* server/public/

# ---------- run stage ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# copy server app (with node_modules & public)
COPY --from=build /app/server /app/server

EXPOSE 8080
CMD ["node", "server/src/index.js"]
