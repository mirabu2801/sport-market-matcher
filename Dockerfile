FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build

COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY .env.example ./.env.example

CMD ["node", "dist/src/cli.js", "--write", "--interval-minutes", "10"]
