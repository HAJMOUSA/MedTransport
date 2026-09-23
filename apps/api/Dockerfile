FROM node:20-alpine AS builder
WORKDIR /app
# Root context: npm workspaces needs every workspace manifest present to install
COPY package.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN npm install
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN npm run build --workspace=apps/api

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN npm install --omit=dev --ignore-scripts
COPY --from=builder /app/apps/api/dist ./dist
RUN mkdir -p /app/uploads/otp-photos
EXPOSE 3001
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
