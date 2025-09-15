# Use official Node image
FROM node:18-bullseye

# Install Chromium dependencies + build tools
RUN apt-get update && apt-get install -y \
    chromium \
    build-essential \
    python3 \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libdbus-1-3 \
    libgbm1 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libcups2 \
    libxss1 \
    libxrender1 \
    xdg-utils \
    wget \
    --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application code
COPY . .

# Puppeteer path
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Expose API port
EXPOSE 3000

# Run app
CMD ["node", "index.js"]
