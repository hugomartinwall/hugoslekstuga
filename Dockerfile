# Munch WebSocket server image. Built and deployed to Fly.io —
# the rest of the site is static-hosted on Vercel and isn't part of this
# image. We run the server with tsx at runtime (no compile step) because
# the server is small enough that startup cost is invisible and skipping
# the build pipeline keeps the Dockerfile honest.

FROM node:20-alpine

WORKDIR /app

# Install only production deps. tsx + ws + types are in `dependencies` for
# this exact reason — see package.json.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy only what the server imports — keeps the image small and the Next
# app's source out of a server-side container.
COPY tsconfig.json ./
COPY server ./server
COPY lib/munch ./lib/munch
COPY lib/noodle ./lib/noodle

# Default port. Fly maps :443 → :8080 via fly.toml's internal_port.
EXPOSE 8080

# Run as the unprivileged `node` user the base image ships with.
USER node

CMD ["npm", "run", "munch"]
