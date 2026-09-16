# ui/ — frontend de la app de escritorio

Este es el **código del frontend de AyudanteAlbionDesktop.exe**, y es
propiedad exclusiva de la app de escritorio.

## Por qué existe

Antes, el escritorio copiaba `albion-app/` tal cual al compilar: cualquier
cambio en la web llegaba automáticamente al `.exe` y al revés. Eso hacía
imposible tocar una sin arriesgar la otra.

Desde el desacople, **esta carpeta es un fork versionado de `albion-app/`**:

- Cambiar la web (`albion-app/`) **no** afecta al escritorio.
- Cambiar el escritorio (`desktop/ui/`) **no** afecta a la web.

Los dos productos evolucionan por separado y tienen sus propios workflows.

**Primera divergencia concreta del fork:** las pestañas **Sesión**,
**Recolección** y **Mazmorras** (con `js/tracker/` y los CSS
`tracker-setup.css`, `gathering.css` y `dungeons.css`) existen **solo acá**: la
web pública ya no las muestra ni las carga. El interruptor «seguimiento de
comercio» del Registro de operaciones también es exclusivo del escritorio.

## Qué hay acá y qué no

| | Origen | Versionado |
|---|---|---|
| `index.html`, `app.js`, `styles.css`, `js/`, `css/` | **esta carpeta** | sí |
| `data/`, `icons/`, `img/` | `albion-app/` (compartido) | no — se copian al compilar |

Los **assets** (íconos de ítems, tablas de datos de Albion) se siguen tomando
de `albion-app/` en tiempo de build, en una sola dirección. Son ~18 MB y más de
3.300 archivos sin lógica: nunca divergen entre web y escritorio, así que
duplicarlos en git sería puro peso muerto. Los copia `sync_frontend.sh`.

## Flujo de trabajo

```bash
./desktop/sync_frontend.sh   # arma desktop/frontend/ (código + assets)
cd desktop && wails build    # compila AyudanteAlbionDesktop.exe
```

`desktop/frontend/` es **generado**: no se versiona, no lo edites a mano.
Editá siempre acá, en `desktop/ui/`.

## Portar un cambio desde la web

No hay sincronización automática — es a propósito. Si arreglás algo en
`albion-app/` que también aplica al escritorio, traé el cambio a mano:

```bash
diff -u albion-app/app.js desktop/ui/app.js
```
