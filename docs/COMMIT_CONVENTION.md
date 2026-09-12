# Convención de mensajes de commit

A partir de ahora, **todos** los commits de este repositorio deben usar como mensaje
únicamente el **nombre del archivo** modificado, sin ruta, sin descripción y sin prefijos.

## Regla

```
<nombre-del-archivo>
```

- Solo el nombre base del archivo (sin directorios).
- Sin descripción de lo que se hizo.
- Sin prefijos tipo `feat:`, `fix:`, `chore:`.
- Sin punto final, sin emojis.
- Una sola línea (el cuerpo del commit debe quedar vacío).

## Ejemplos

| Correcto | Incorrecto |
|---|---|
| `index.html` | `Actualizo index.html con nuevo header` |
| `style.css` | `albion-app/src/style.css` |
| `build.sh` | `fix: build.sh` |

## Dónde van las descripciones

Esta convención mantiene el historial de commits como un índice simple de
archivos tocados. Las descripciones humanas de cada cambio deben vivir en los
lugares que sí se pueden corregir con un PR normal:

- `CHANGELOG.md`, para resumir lo que ya entró o está por entrar en `main`.
- `docs/releases/`, para notas largas de una versión publicada o próxima.
- El cuerpo del pull request, para explicar contexto, validación y alcance antes
  de mergear.

Si una descripción de cambios en `main` quedó incompleta o confusa, no se
reescribe el commit con `amend`, `rebase` ni `push --force`. Se abre una rama, se
actualiza la documentación correspondiente y se mergea por PR.

## Varios archivos

Si un commit toca más de un archivo, se recomienda **dividirlo en un commit por archivo**.
Si no es posible, usar los nombres separados por coma:

```
index.html, style.css
```

## Automatización

El repositorio incluye hooks de Git en `.githooks/`:

- `prepare-commit-msg`: si no escribes mensaje, lo genera automáticamente con el
  nombre del/los archivo(s) en staging.
- `commit-msg`: valida que el mensaje cumpla la regla y rechaza el commit si no.

### Activación (una sola vez por clon)

```bash
git config core.hooksPath .githooks
```

O bien, desde la raíz del repositorio:

```bash
./scripts/setup_hooks.sh
```

### Saltarse la validación (casos excepcionales)

Merges, reverts y commits generados por Git (`Merge ...`, `Revert ...`,
`fixup!`, `squash!`) se aceptan automáticamente. Para cualquier otro caso:

```bash
git commit --no-verify -m "mensaje libre"
```
