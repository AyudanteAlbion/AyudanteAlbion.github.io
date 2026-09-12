# Convención de mensajes de commit

Los commits normales de este repositorio usan una sola línea que identifica
el elemento de primer nivel modificado, sin prefijos, hora ni texto adicional.
Los archivos en la raíz usan su nombre; cualquier archivo dentro de una carpeta
usa el nombre de esa carpeta.

## Formato

```text
<archivo-raíz-o-carpeta-raíz>
```

Por ejemplo, cambios en `docs/index.html` producen el mensaje `docs`, y cambios
en `.github/workflows/validate.yml` producen `.github`. Si un commit toca
varios elementos de primer nivel, se separan por coma y en orden alfabético:
`.github, docs, README.md`.

No se permite cuerpo, descripción adicional, emojis, hora ni trailers en
commits normales.

## Archivos y validación

La lista del mensaje debe coincidir exactamente con los elementos de primer
nivel que contienen archivos agregados, modificados, eliminados o renombrados
por ese commit. Varios archivos dentro de la misma carpeta cuentan como un solo
elemento.

El repositorio incluye hooks de Git en `.githooks/`:

- `prepare-commit-msg`: si no escribes un mensaje, genera automáticamente el
  nombre del/los archivo(s) en staging.
- `commit-msg`: valida que el mensaje sea exactamente el nombre del/los
  archivo(s) en staging. Un mensaje manual que no cumpla la regla se rechaza.

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
