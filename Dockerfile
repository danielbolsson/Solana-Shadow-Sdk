FROM node:20-slim

WORKDIR /app

# Install system dependencies (needed for compilation or native modules)
RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*

# Copy package files first to leverage caching
COPY package.json package-lock.json ./
COPY privacy-integration/package.json privacy-integration/package-lock.json ./privacy-integration/
COPY packages/core/package.json ./packages/core/
COPY circuits/package.json ./circuits/
COPY web-dashboard/package.json web-dashboard/package-lock.json ./web-dashboard/

# Install dependencies (using npm workspaces)
RUN npm install

# Build core packages
RUN npm run build

# Install dashboard dependencies specifically if needed (though root install should cover it)
RUN cd web-dashboard && npm install

# Copy source code
COPY . .

# Build circuits if needed (optional, but good for verification)
# RUN cd circuits && ./build.sh
# (Skipping build to save time, assuming pre-built artifacts are copied or not strictly needed for just running the server if logic is detached)
# Actually, dashboard server assumes circuits are built if it references keys? 
# shadow-config.json references "circuits/build/..."
# So we need those files. I'll assume the user builds them before or we copy them. 
# .dockerignore excludes "circuits/build/", so we MUST build them or remove that exclusion.
# Wait, I added "circuits/build/" to .dockerignore...
# If I exclude them, I MUST build them inside.
# But building takes time and requires circom.
# User said "circom.exe" (windows) gave errors.
# If I build inside, I need circom linux binary.
# Better option: Allow "circuits/build/" to be copied if they exist locally and are linux compatible?
# Or just install circom in docker and build.
# Installing circom is heavy.
# Let's remove "circuits/build/" from .dockerignore so we can just copy the artifacts the user likely already has (if they are cross-platform like .zkey/.wasm).
# .r1cs and .zkey and .wasm are platform independent.
# So I should ALLOW circuits/build in dockerignore.

# Removing circuits/build/ from .dockerignore (will do in next step) implies COPY . . will bring them in.

# Expose port
EXPOSE 5000

# Environment variables
ENV PORT=5000
ENV NODE_ENV=production
# RELAYER_KEYPAIR_PATH must be set at runtime

# Start the server
WORKDIR /app/monitoring
CMD ["npm", "start"]
