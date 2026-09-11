#!/usr/bin/env bash
# ============================================================
# Build de distribución de Ayudante Albion
#   1. Verifica sintaxis de app.js
#   2. Corre la prueba de humo (jsdom)
#   3. Sincroniza la app dentro de albion-exe/app/ (el heartbeat vive en app.js)
#   4. Compila AyudanteAlbion.exe (Windows, sin consola)
#   5. Genera AyudanteAlbion.zip
# Uso: ./build.sh [--skip-tests]
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

GO_BIN="${GO_BIN:-/tmp/go/bin/go}"

echo "── 1/5 · Sintaxis de app.js"
node --check albion-app/app.js
echo "   OK"

if [[ "${1:-}" != "--skip-tests" ]]; then
  echo "── 2/5 · Prueba de humo (jsdom)"
  ( cd albion-app && node smoke-test.js )
else
  echo "── 2/5 · Prueba de humo OMITIDA (--skip-tests)"
fi

echo "── 3/5 · Sincronizando albion-exe/app/"
mkdir -p albion-exe/app
cp albion-app/index.html albion-exe/app/index.html
cp albion-app/app.js albion-app/styles.css albion-exe/app/
# Módulos del frontend: index.html los carga con <script src="js/...">. Sin
# esta copia el .exe los pide y recibe 404, y la app cae a los fallbacks.
# El README de la carpeta es documentación de desarrollo: no se embebe.
rm -rf albion-exe/app/js && cp -r albion-app/js albion-exe/app/ && rm -f albion-exe/app/js/README.md
rm -rf albion-exe/app/data && cp -r albion-app/data albion-exe/app/
rm -rf albion-exe/app/icons && cp -r albion-app/icons albion-exe/app/
cp -r albion-app/img albion-exe/app/ && rm -rf albion-exe/app/img/logo-opts
# Verificación del artefacto embebido: si index.html referencia algo que no
# está en albion-exe/app/, el build aborta antes de compilar el .exe.
node albion-app/assets-test.js albion-exe/app
echo "   OK"

echo "── 4/5 · Compilando AyudanteAlbion.exe"
GO_VERSION="1.23.4"
# SHA256 oficial del tarball, publicado en https://go.dev/dl/?mode=json&include=all
# (verificado además contra los pines de buildroot y bazel). El .exe que se
# distribuye se compila con esta toolchain: si cambiás GO_VERSION, cambiá el
# checksum acá — y si el tarball bajado no coincide, el build aborta a propósito.
GO_SHA256="6924efde5de86fe277676e929dc9917d466efa02fb934197bc2eba35d5680971"
if [[ ! -x "$GO_BIN" ]]; then
  echo "   Go no encontrado en $GO_BIN — descargando (versión verificada por checksum)…"
  curl -sL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tar.gz
  echo "${GO_SHA256}  /tmp/go.tar.gz" | sha256sum -c - >/dev/null \
    || { echo "   ERROR: el checksum de Go no coincide (tarball corrupto o alterado). Abortando."; exit 1; }
  tar -C /tmp -xzf /tmp/go.tar.gz
fi
( cd albion-exe && GOOS=windows GOARCH=amd64 "$GO_BIN" build \
    -ldflags="-s -w -H windowsgui" -o AyudanteAlbion.exe . )
ls -lh albion-exe/AyudanteAlbion.exe | awk '{print "   " $5 "  " $9}'

echo "── 5/5 · Generando AyudanteAlbion.zip"
rm -f AyudanteAlbion.zip
zip -q -r AyudanteAlbion.zip \
  LICENSE \
  albion-exe/AyudanteAlbion.exe albion-exe/LEEME.txt \
  albion-exe/main.go albion-exe/go.mod albion-app \
  -x "albion-app/node_modules/*" -x "albion-app/img/logo-opts/*" \
  -x "albion-app/smoke-test.js" -x "albion-app/qa-test.js" \
  -x "albion-app/black-market-test.js" -x "albion-app/farm-test.js" \
  -x "albion-app/tracker-evidence-test.js" \
  -x "albion-app/botones.html" -x "albion-app/iconos.html"
ls -lh AyudanteAlbion.zip | awk '{print "   " $5 "  " $9}'

echo ""
echo "✅ Build completo."
#

