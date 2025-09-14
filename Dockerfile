# First stage - install dependencies
FROM node:18-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm install

# Second stage - use official Lighthouse image
FROM ghcr.io/googlechrome/lighthouse:latest
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "index.js"]