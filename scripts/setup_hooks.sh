#!/usr/bin/env bash
# Activa los hooks de la convencion de commits.
set -euo pipefail
cd "$(dirname "$0")/.."
chmod +x .githooks/* 2>/dev/null || true
git config core.hooksPath .githooks
echo "Hooks activados (core.hooksPath = .githooks)."
echo "Formato: el mensaje es el nombre exacto del archivo (ej.: README.md)."
