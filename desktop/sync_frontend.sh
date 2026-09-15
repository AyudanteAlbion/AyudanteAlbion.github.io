#!/usr/bin/env bash
# ============================================================
# Sincroniza albion-app/ dentro de desktop/frontend/ para que
# //go:embed all:frontend tome la app completa al compilar.
#
# Es el mismo patrón que build.sh usa con albion-exe/app/: el
# contenido copiado no se versiona (ver .gitignore), se regenera
# desde la fuente única albion-app/.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

SRC="../albion-app"
DST="frontend"

echo "── Sincronizando $SRC → $DST/"

# Conserva el README.md marcador; limpia el resto del contenido copiado.
find "$DST" -mindepth 1 -not -name 'README.md' -delete 2>/dev/null || true

cp "$SRC/index.html" "$DST/index.html"
cp "$SRC/app.js" "$SRC/styles.css" "$DST/"
cp -r "$SRC/js" "$DST/"
cp -r "$SRC/data" "$DST/"
cp -r "$SRC/icons" "$DST/"
cp -r "$SRC/img" "$DST/"
rm -rf "$DST/img/logo-opts"

echo "   OK — frontend listo para embeber"
