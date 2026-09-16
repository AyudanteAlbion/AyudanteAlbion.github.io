#!/usr/bin/env bash
# ============================================================
# Prepara desktop/frontend/ para que //go:embed all:frontend
# tome la app completa al compilar AyudanteAlbionDesktop.exe.
#
# IMPORTANTE — la app de escritorio NO depende de albion-app/
# para su código. Desde el desacople, el frontend está dividido
# en dos orígenes bien distintos:
#
#   1. CÓDIGO (desktop/ui/) — versionado, propiedad exclusiva
#      del escritorio. Es un fork de albion-app/: HTML, JS y CSS.
#      Tocar la web NO cambia el escritorio, y viceversa.
#
#   2. ASSETS (albion-app/{data,icons,img}) — compartidos y de
#      una sola dirección. Son íconos de ítems y tablas de datos
#      de Albion (~18 MB, 3.300+ archivos): no contienen lógica,
#      nunca divergen entre web y escritorio, y duplicarlos en
#      git no aportaría nada. Se copian al compilar.
#
# El contenido de frontend/ es generado: no se versiona.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

UI="ui"
ASSETS="../albion-app"
DST="frontend"

echo "── Preparando $DST/"

# Conserva el README.md marcador; limpia el resto del contenido generado.
find "$DST" -mindepth 1 -not -name 'README.md' -delete 2>/dev/null || true

# 1. Código propio del escritorio (fork versionado).
echo "   código   ← $UI/"
cp "$UI/index.html" "$UI/app.js" "$UI/styles.css" "$DST/"
cp -r "$UI/js" "$DST/"
cp -r "$UI/css" "$DST/"
# Datos propios del escritorio, p. ej. el índice ID de cluster → mapa visible.
if [ -d "$UI/data" ]; then
  cp -r "$UI/data" "$DST/"
fi

# 2. Assets compartidos (solo lectura, desde la fuente única).
echo "   assets   ← $ASSETS/{data,icons,img}"
cp -r "$ASSETS/data" "$DST/"
cp -r "$ASSETS/icons" "$DST/"
cp -r "$ASSETS/img" "$DST/"
rm -rf "$DST/img/logo-opts"

echo "   OK — frontend listo para embeber"
