FROM node:22-bookworm-slim

ARG DEBIAN_MIRROR=""
ARG NPM_REGISTRY=""

ENV DEBIAN_FRONTEND=noninteractive \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN if [ -n "$DEBIAN_MIRROR" ]; then \
        sed -i "s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
    fi && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 \
    python-is-python3 \
    python3-pip \
    pkg-config \
    xvfb \
    xauth \
    libgl1-mesa-dev \
    libgles2-mesa-dev \
    libosmesa6-dev \
    build-essential \
    libpixman-1-dev \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libxi-dev \
    libxinerama-dev \
    libxrandr-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY patches ./patches
RUN if [ -n "$NPM_REGISTRY" ]; then \
        npm config set registry "$NPM_REGISTRY"; \
    fi && \
    if [ -f package-lock.json ]; then \
        npm ci --no-audit --progress=false; \
    else \
        npm install --no-audit --progress=false; \
    fi

COPY . .

CMD ["node", "main.js"]
