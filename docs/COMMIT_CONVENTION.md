# Convención de mensajes de commit

A partir de ahora, los commits normales de este repositorio usan una sola línea
con el archivo modificado y la hora UTC del cambio. Así, el mensaje que GitHub
muestra junto a cada archivo mantiene siempre el mismo formato.

## Formato

```text
archivo ----- <nombre-del-archivo> ---- <AAAA-MM-DD HH:MM:SS UTC>
```

Por ejemplo:

```text
archivo ----- README.md ---- 2026-09-12 15:42:00 UTC
```

- `archivo` es el prefijo fijo.
- `<nombre-del-archivo>` es el nombre base del/los archivo(s), sin ruta.
- La hora se genera en UTC con formato de 24 horas.
- Si un commit toca varios archivos, sus nombres se separan por coma:
  `archivo ----- app.js, style.css ---- 2026-09-12 15:42:00 UTC`.
- No se permite cuerpo, descripción adicional, emojis ni trailers en commits
  normales.

La hora identifica el momento en que se prepara el commit. GitHub seguirá
mostrando además su propio tiempo relativo —por ejemplo, `10 minutes ago`—
al lado del mensaje.

## Archivos y validación

La lista de nombres del mensaje debe coincidir exactamente con los archivos
agregados, modificados, eliminados o renombrados por ese commit. Se usan nombres
base para que el mensaje sea breve; por eso conviene dividir un cambio grande
en un commit por archivo cuando sea posible.

El repositorio incluye hooks de Git en `.githooks/`:

- `prepare-commit-msg`: si no escribes un mensaje, genera automáticamente el
  formato con los archivos en staging y la hora UTC actual.
- `commit-msg`: valida el formato, la fecha y la correspondencia con los
  archivos en staging. Un mensaje manual que no cumpla la regla se rechaza.

GitHub Actions también ejecuta `.github/workflows/commit-messages.yml` en cada
pull request y revisa todos sus commits. Los commits generados por Git para
merges, reverts, `fixup!` y `squash!` se aceptan como excepciones.

### Activación (una sola vez por clon)

```bash
git config core.hooksPath .githooks
```

O bien, desde la raíz del repositorio:

```bash
./scripts/setup_hooks.sh
```

### Casos excepcionales

No se reescribe el historial de `main` ni se fuerza un push para cambiar
mensajes antiguos. Para una excepción puntual, la validación puede saltarse
explícitamente:

```bash
git commit --no-verify -m "mensaje libre"
```

Los commits creados con `--no-verify` no deben usarse como modelo para cambios
posteriores.
