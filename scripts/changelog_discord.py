#!/usr/bin/env python3
"""Extrae el changelog de la última versión de CHANGELOG.md para publicarlo
en Discord (canal de Actualizaciones).

Se usa desde el workflow `.github/workflows/main.yml`: cuando un push a `main`
toca `CHANGELOG.md`, este script prepara el embed con lo agregado, lo cambiado
y lo corregido de la versión más reciente (la que encabeza el archivo).

Uso:
    python3 scripts/changelog_discord.py [URL_DEL_CHANGELOG]

    - URL_DEL_CHANGELOG (opcional): enlace al CHANGELOG.md en GitHub. Se usa en
      el aviso cuando el cuerpo se recorta para caber en Discord.

Salida (JSON en stdout, un solo objeto):
    {
      "title": "📝 Changelog v1.3.0 — sin publicar",
      "description": "**Añadido**\\n- …\\n\\n**Cambiado**\\n- …\\n\\n**Corregido**\\n- …",
      "url": "https://github.com/…/blob/main/CHANGELOG.md",
      "color": 13937175
    }

    El objeto ya tiene la forma de un embed de Discord; el workflow solo lo
    envuelve en {"embeds": [ … ]}. Si CHANGELOG.md no tiene ninguna sección de
    versión, el script falla con código distinto de cero para que el step lo
    acuse (nunca debería pasar: el step solo corre cuando el archivo cambió).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# Límite holgado para la descripción de un embed de Discord (4096): deja margen
# para el aviso de recorte y para que el título no dependa de la longitud.
DESCRIPTION_LIMIT = 3800

# Secciones del changelog que se publican, en el orden en que aparecen. Se
# ignora el resto (Validación, Notas, enlaces a docs/releases…).
WANTED = ("Añadido", "Cambiado", "Corregido")

VERSION_HEADER = re.compile(r"^## \[([^\]]+)\]")
SUBSECTION = re.compile(r"^###\s+(.+?)\s*$")
BULLET = re.compile(r"^(\s*)-\s+(.*)$")

GOLD = 13937175  # dorado del yunque, a juego con la marca de la app


def read_changelog(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def latest_section(text: str):
    """Devuelve (versión, nota, líneas) de la versión que encabeza el archivo."""
    lines = text.splitlines()
    headers = [i for i, line in enumerate(lines) if VERSION_HEADER.match(line)]
    if not headers:
        raise SystemExit("CHANGELOG.md sin secciones de versión")
    start = headers[0]
    end = headers[1] if len(headers) > 1 else len(lines)
    header = lines[start]
    version = VERSION_HEADER.match(header).group(1)
    note = header.split("]", 1)[1].strip().lstrip("-— \t").strip()
    return version, note, lines[start + 1 : end]


def split_subsections(lines):
    """Agrupa las líneas de la sección bajo cada `### Título`."""
    subs = []
    current = None
    for line in lines:
        match = SUBSECTION.match(line)
        if match:
            current = (match.group(1), [])
            subs.append(current)
        elif current is not None:
            current[1].append(line)
    return subs


def reflow(block):
    """Une las líneas continuadas de cada viñeta en una sola.

    CHANGELOG.md parte las viñetas en líneas de ~80 columnas; Discord no
    necesita esos saltos y quedarían irregulares. Cada `- ` inicia una viñeta
    nueva y las líneas sangradas se pegan a la viñeta anterior.
    """
    out = []
    bullet = None

    def flush():
        nonlocal bullet
        if bullet is not None:
            out.append(bullet)
            bullet = None

    for line in block:
        stripped = line.strip()
        if not stripped:
            flush()
            continue
        match = BULLET.match(line)
        if match:
            flush()
            bullet = "- " + match.group(2).strip()
            continue
        if line[:1] in (" ", "\t"):
            if bullet is not None:
                bullet += " " + stripped
            else:
                out.append(stripped)
            continue
        flush()
        out.append(stripped)
    flush()
    return out


def build_body(subs):
    """Arma la descripción con Añadido/Cambiado/Corregido en negrita."""
    parts = []
    for title, block in subs:
        if title not in WANTED:
            continue
        lines = reflow(block)
        if not lines:
            continue
        parts.append("**" + title + "**\n" + "\n".join(lines))
    return "\n\n".join(parts)


def truncate(body: str, url: str):
    if len(body) <= DESCRIPTION_LIMIT:
        return body, False
    cut = body[:DESCRIPTION_LIMIT].rsplit("\n", 1)[0]
    tail = "\n\n… Changelog completo: " + url if url else "\n\n… (ver CHANGELOG.md)"
    return cut + tail, True


def main(argv):
    root = Path(__file__).resolve().parents[1]
    path = root / "CHANGELOG.md"
    url = argv[1] if len(argv) > 1 else ""
    version, note, lines = latest_section(read_changelog(path))
    body = build_body(split_subsections(lines))
    if not body:
        # Sin secciones reconocidas (p. ej. una versión «sin notas»): publicar
        # igual, con lo que haya, para no dejar el canal en silencio.
        body = "Sin secciones Añadido/Cambiado/Corregido en esta versión."
    description, truncated = truncate(body, url)
    if truncated:
        print("aviso: changelog recortado para caber en el embed de Discord", file=sys.stderr)
    title = "📝 Changelog " + version
    if note:
        title += " — " + note
    embed = {
        "title": title,
        "description": description,
        "color": GOLD,
    }
    if url:
        embed["url"] = url
    print(json.dumps(embed, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv)
