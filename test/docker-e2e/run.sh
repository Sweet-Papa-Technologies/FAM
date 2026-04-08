#!/bin/bash
set -e
cd "$(dirname "$0")"
docker compose build

if [ $# -eq 0 ]; then
  # No args: run all categories (use default CMD)
  docker compose run --rm e2e-runner
else
  # Args provided: pass as category filter to runner
  docker compose run --rm e2e-runner node test/docker-e2e/runner.mjs "$@"
fi
