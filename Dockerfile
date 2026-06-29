# A2G plan service — production image. Runs the TypeScript server via tsx (kept in
# dependencies), so there's no separate build step.
FROM node:24-slim

WORKDIR /app

# Install deps first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# App source. prompts/ is required at runtime; .dockerignore keeps secrets/dev cruft out.
COPY . .

ENV NODE_ENV=production
# Railway/Render inject PORT at runtime; 3000 is the local/VPS default.
EXPOSE 3000

CMD ["npm", "start"]
