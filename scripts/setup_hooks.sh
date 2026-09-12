#!/usr/bin/env bash
# Activa los hooks de convencion de commits.
set -euo pipefail
cd "$(dirname "$0")/.."
chmod +x .githooks/* 2>/dev/null || true
git config core.hooksPath .githooks
echo "Hooks activados (core.hooksPath = .githooks)."
echo "Convencion: el mensaje de commit es solo el nombre del archivo."
