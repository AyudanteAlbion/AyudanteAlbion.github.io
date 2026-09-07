# ⚔️ Ayudante Albion

Herramientas de mercado y crafteo para **Albion Online** (servidor Américas / West), creada para el gremio **Spetsnaz Grail**.

🌐 Web del gremio: https://spetsnazgrail.com · 💬 Discord: https://discord.gg/cqG7rDmUSJ

## Herramientas

| Herramienta | Descripción |
|---|---|
| 🍲 **Cocina** | Rentabilidad de crafteo de comida (Caerleon) con RRR, foco y bonos |
| ⚒️ **Crafteo de equipo** | Armas y armaduras con ciudad de especialización |
| 🪵 **Refinamiento** | Madera, mineral, piedra, piel y fibra |
| ⚗️ **Alquimia** | Pociones (Brecilien) |
| ✨ **Encantado** | Comprar directo vs. encantar con fragmentos (cantidades oficiales del juego) |
| 🌾 **Granja** | Cultivos, animales y productores — ganancia diaria por parcela |
| 📈 **Flipping** | Comprar en ciudades reales → vender en Mercado Negro |
| 🔄 **Transmutación** | Costo de subir tier/encantamiento vs. comprar |
| 🧩 **Artefactos** | Fusión de fragmentos (melding) con valor esperado por estrategia |
| 🔍 **Buscador de precios** | Cualquier ítem, 7 ciudades + Mercado Negro, todas las calidades |
| 📒 **Registro de operaciones** | Diario personal de compras/ventas con P&L y exportación CSV |

## 📥 Descargas

**[⬇️ Descargar AyudanteAlbion.exe](https://github.com/Guallama31/AyudanteAlbion/releases/latest)** — en la sección **Releases** del repositorio.

- `AyudanteAlbion.exe`: doble clic y la app se abre en tu navegador. Se apaga sola al cerrar la pestaña.
- `AyudanteAlbion.zip`: paquete completo (.exe + código fuente).

> El `.exe` compilado no está en el código fuente del repositorio (los binarios no van al historial de git); siempre se descarga desde Releases.

## Estructura del repositorio

```
albion-app/     ← la aplicación web (HTML/CSS/JS puro, sin build)
  index.html
  app.js        ← toda la lógica y fórmulas
  styles.css
  server.py     ← servidor local de desarrollo (puerto 3000)
  data/         ← recetas y datos extraídos de ao-bin-dumps
  icons/        ← 3.300+ íconos de ítems (locales)
  img/          ← logos e imágenes
albion-exe/     ← ejecutable de escritorio para Windows (Go)
  main.go       ← servidor embebido + apertura de navegador + auto-apagado
```

## Ejecutar en local

```bash
cd albion-app
python3 server.py
# abrir http://localhost:3000
```

## Compilar el .exe de Windows

```bash
cd albion-exe
# 1. sincronizar la app dentro de albion-exe/app/ (con el script de build)
# 2. compilar:
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w -H windowsgui" -o AyudanteAlbion.exe .
```

## Datos

- **Precios en tiempo real**: [Albion Online Data Project](https://www.albion-online-data.com/) — solo servidor **Américas (West)**.
- **Recetas y datos del juego**: [ao-bin-dumps](https://github.com/ao-data/ao-bin-dumps).

Los precios tienen la antigüedad del último escaneo de la comunidad; todos los valores son editables manualmente en la app.

---

*Hecho por y para la comunidad de Spetsnaz Grail.*
