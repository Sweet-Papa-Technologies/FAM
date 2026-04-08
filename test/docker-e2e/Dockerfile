# ---------------------------------------------------------------------------
# FAM Docker E2E Test Image
#
# Builds a self-contained environment with:
#   - Node 22, dbus, gnome-keyring (for vault tests)
#   - Python 3 (for pip-installable agents like aider, openhands)
#   - FAM globally linked so `fam` is on PATH
# ---------------------------------------------------------------------------

FROM node:22-bookworm

# System packages needed for keyring, native modules, and agent installs
RUN apt-get update && apt-get install -y --no-install-recommends \
    dbus \
    dbus-x11 \
    gnome-keyring \
    libsecret-1-dev \
    python3 \
    python3-pip \
    python3-venv \
    git \
    curl \
    jq \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

# Create non-root user with a home directory
RUN useradd -m -s /bin/bash famtest

# Configure npm global prefix for famtest user (avoids EACCES on npm -g)
RUN mkdir -p /home/famtest/.npm-global \
  && chown famtest:famtest /home/famtest/.npm-global

# pip user-local bin
RUN mkdir -p /home/famtest/.local/bin \
  && chown -R famtest:famtest /home/famtest/.local

# Working directory
WORKDIR /home/famtest/fam

# --- Layer caching: deps first, then source ---
# 1. Copy package files + scripts (needed by npm lifecycle hooks)
COPY --chown=famtest:famtest package.json package-lock.json ./
COPY --chown=famtest:famtest scripts/ scripts/

# 2. Install deps (compiles native modules for THIS platform/Node version)
RUN npm ci && chown -R famtest:famtest node_modules

# 3. Copy source code ONLY (not node_modules, not dist — those are Docker's own)
COPY --chown=famtest:famtest src/ src/
COPY --chown=famtest:famtest test/ test/
COPY --chown=famtest:famtest tsconfig.json tsup.config.ts ./
COPY --chown=famtest:famtest fam.yaml README.md LICENSE* ./
COPY --chown=famtest:famtest docs/ docs/

# 4. Build and globally link so `fam` command works
RUN npm run build && npm link

# 5. Copy entrypoint
COPY --chown=famtest:famtest test/docker-e2e/entrypoint.sh /home/famtest/entrypoint.sh
RUN chmod +x /home/famtest/entrypoint.sh

# Switch to non-root user
USER famtest

# Configure npm global prefix for the user (agent installs go here)
RUN npm config set prefix /home/famtest/.npm-global

# PATH: global npm + pip user installs
ENV PATH="/home/famtest/.npm-global/bin:/home/famtest/.local/bin:/usr/local/bin:${PATH}"
ENV HOME="/home/famtest"
ENV PIP_BREAK_SYSTEM_PACKAGES=1

ENTRYPOINT ["/home/famtest/entrypoint.sh"]
CMD ["node", "test/docker-e2e/runner.mjs"]
