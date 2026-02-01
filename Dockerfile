FROM node:24-slim

WORKDIR /app

# Install system dependencies (needed for compilation or native modules)
RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*

# Copy package files first to leverage caching
COPY package.json package-lock.json turbo.json tsconfig.json ./
COPY privacy-integration/package.json privacy-integration/package-lock.json ./privacy-integration/
COPY packages/core/package.json ./packages/core/
COPY circuits/package.json ./circuits/
COPY web-dashboard/package.json ./web-dashboard/

# Environment variables
ENV PORT=5000
ENV TURBO_TELEMETRY_DISABLED=1

# Install dependencies (using npm workspaces)
# We don't set NODE_ENV=production yet so that devDependencies (like turbo) are installed
RUN npm install

# Copy source code
COPY . .

# Build core packages (excluding circuits since they are copied pre-built)
RUN npm run build -- --filter=!@shadow-sdk/circuits

# Set production environment for runtime
ENV NODE_ENV=production

# Expose port
EXPOSE 5000

# Start the server
WORKDIR /app/web-dashboard
CMD ["npm", "start"]
