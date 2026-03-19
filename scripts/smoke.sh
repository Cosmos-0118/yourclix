#!/usr/bin/env bash
set -euo pipefail

# Lightweight smoke checks that avoid destructive changes.

echo "[smoke] Typecheck"
npm run typecheck

echo "[smoke] Setup dry run"
node dist/index.js setup --dry-run --profile minimal || true

echo "[smoke] Clean verify"
node dist/index.js clean --verify || true

echo "[smoke] Net reset dry run"
node dist/index.js net reset --dry-run -y || true

echo "[smoke] Spotlight reset dry run"
node dist/index.js spotlight reset --dry-run || true

echo "[smoke] Dev reset dry run"
node dist/index.js dev reset node --dry-run || true

echo "[smoke] Startup list"
node dist/index.js startup list || true

echo "[smoke] Plugin list"
node dist/index.js plugin list || true

echo "[smoke] Done"
