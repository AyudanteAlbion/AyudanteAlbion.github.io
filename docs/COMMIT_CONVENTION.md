# Convención de mensajes de commit

Los commits normales de este repositorio usan una sola línea cuyo contenido es
**exactamente el nombre del archivo modificado**, sin prefijos, sin hora y sin
texto adicional. Así, el mensaje que GitHub muestra junto a cada archivo es
siempre el nombre del propio archivo.

## Formato

```text
<nombre-del-archivo>
```

Por ejemplo:

```text
README.md
```

- El mensaje es el nombre base del archivo, sin ruta (por ejemplo,
  `docs/index.html` produce el mensaje `index.html`).
- Si un commit toca varios archivos, sus nombres se separan por coma y en
  orden alfabético: `app.js, style.css`.
- No se permite cuerpo, descripción adicional, emojis, hora ni trailers en
  commits normales.

## Archivos y validación

La lista de nombres del mensaje debe coincidir exactamente con los archivos
agregados, modificados, eliminados o renombrados por ese commit. Se usan nombres
base para que el mensaje sea breve; por eso conviene dividir un cambio grande
en un commit por archivo cuando sea posible.

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
