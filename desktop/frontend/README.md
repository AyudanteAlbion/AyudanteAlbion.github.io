# frontend/ — sincronizado en build

Esta carpeta se **rellena automáticamente** con el contenido de `albion-app/`
antes de compilar (ver `desktop/sync_frontend.sh` y el workflow
`.github/workflows/desktop.yml`). El contenido real (HTML, JS, CSS, íconos y
datos) **no se versiona**: se copia igual que `albion-exe/app/`.

Este `README.md` es solo un marcador para que `//go:embed all:frontend`
siempre tenga al menos un archivo y el paquete compile aunque la sincronización
no se haya corrido todavía.

Para poblarla a mano:

```bash
./desktop/sync_frontend.sh
```
