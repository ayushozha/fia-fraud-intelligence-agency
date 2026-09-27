#!/bin/sh
set -e
cd "$(dirname "$0")"
if [ -f ../../.env ]; then
  exec uv run --quiet --env-file ../../.env python serve.py
fi
exec uv run --quiet python serve.py
