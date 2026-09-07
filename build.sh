#!/usr/bin/env bash
# ============================================================
# Build de distribución de Ayudante Albion
#   1. Verifica sintaxis de app.js
#   2. Corre la prueba de humo (jsdom)
#   3. Sincroniza la app dentro de albion-exe/app/ (+ heartbeat)
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
python3 - << 'EOF'
h = open('albion-app/index.html').read()
hb = '''<script>
/* Latido para el ejecutable de escritorio: avisa al servidor que la app
   sigue abierta. Si no hay pestañas abiertas por unos segundos, el
   servidor embebido se apaga solo. En el server.py normal, /alive
   devuelve 404 y esto no hace nada. */
setInterval(() => { fetch('/alive').catch(() => {}); }, 3000);
</script>
</body>'''
h2 = h.replace('</body>', hb)
assert '/alive' in h2, 'no se pudo insertar el heartbeat'
open('albion-exe/app/index.html', 'w').write(h2)
EOF
cp albion-app/app.js albion-app/styles.css albion-exe/app/
rm -rf albion-exe/app/data && cp -r albion-app/data albion-exe/app/
rm -rf albion-exe/app/icons && cp -r albion-app/icons albion-exe/app/
cp -r albion-app/img albion-exe/app/ && rm -rf albion-exe/app/img/logo-opts
echo "   OK"

echo "── 4/5 · Compilando AyudanteAlbion.exe"
if [[ ! -x "$GO_BIN" ]]; then
  echo "   Go no encontrado en $GO_BIN — descargando…"
  curl -sL https://go.dev/dl/go1.23.4.linux-amd64.tar.gz -o /tmp/go.tar.gz
  tar -C /tmp -xzf /tmp/go.tar.gz
fi
( cd albion-exe && GOOS=windows GOARCH=amd64 "$GO_BIN" build \
    -ldflags="-s -w -H windowsgui" -o AyudanteAlbion.exe . )
ls -lh albion-exe/AyudanteAlbion.exe | awk '{print "   " $5 "  " $9}'

echo "── 5/5 · Generando AyudanteAlbion.zip"
rm -f AyudanteAlbion.zip
zip -q -r AyudanteAlbion.zip \
  albion-exe/AyudanteAlbion.exe albion-exe/LEEME.txt \
  albion-exe/main.go albion-exe/go.mod albion-app \
  -x "albion-app/node_modules/*" -x "albion-app/img/logo-opts/*" \
  -x "albion-app/smoke-test.js"
ls -lh AyudanteAlbion.zip | awk '{print "   " $5 "  " $9}'

echo ""
echo "✅ Build completo."
