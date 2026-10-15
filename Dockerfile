FROM node:20-alpine

WORKDIR /app

# Install dependencies first for Docker layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source code
COPY . .

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/gym.db

# Ensure data directory exists for persistent SQLite database
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
