# frontend/ — CARPETA GENERADA (no editar, no versionar)

Esta carpeta la **arma automáticamente** `desktop/sync_frontend.sh` antes de
compilar, para que `//go:embed all:frontend` tome la app completa.

Se construye con dos orígenes:

| Contenido | Viene de |
|---|---|
| `index.html`, `app.js`, `styles.css`, `js/`, `css/` | `desktop/ui/` (código propio del escritorio) |
| `data/`, `icons/`, `img/` | `albion-app/` (assets compartidos) |

**Si querés cambiar el frontend del escritorio, editá `desktop/ui/`.**
Cualquier cosa que escribas acá se borra en la próxima sincronización.

```bash
./desktop/sync_frontend.sh
```

Este `README.md` es el único archivo versionado de la carpeta: es un marcador
para que `//go:embed all:frontend` siempre tenga al menos un archivo y el
paquete compile aunque la sincronización no se haya corrido todavía.
