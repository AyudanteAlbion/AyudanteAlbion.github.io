#!/usr/bin/env python3
"""Validaciones pequeñas y sin dependencias externas para el repositorio."""
from __future__ import annotations

import html.parser
import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
ERRORS: list[str] = []


def run(command: list[str], label: str) -> None:
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    if result.returncode:
        detail = (result.stdout + result.stderr).strip()
        ERRORS.append(f"{label}: {detail or 'falló'}")


def validate_javascript() -> None:
    files = sorted(
        path for path in ROOT.rglob("*.js")
        if ".git" not in path.parts and "node_modules" not in path.parts
    )
    for path in files:
        run(["node", "--check", str(path)], f"JavaScript inválido: {path.relative_to(ROOT)}")


def validate_python() -> None:
    files = sorted(
        path for path in ROOT.rglob("*.py")
        if ".git" not in path.parts and "__pycache__" not in path.parts
    )
    if files:
        run([sys.executable, "-m", "py_compile", *map(str, files)], "Python inválido")


class LocalReferences(html.parser.HTMLParser):
    def __init__(self, source: Path) -> None:
        super().__init__()
        self.source = source

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_map = dict(attrs)
        for attribute in ("src", "href"):
            value = attrs_map.get(attribute)
            if not value or value.startswith(("#", "//", "data:", "mailto:", "javascript:")):
                continue
            parsed = urlsplit(value)
            if parsed.scheme or parsed.netloc:
                continue
            target = (self.source.parent / parsed.path).resolve()
            try:
                target.relative_to(ROOT.resolve())
            except ValueError:
                ERRORS.append(f"Referencia fuera del repo: {self.source.relative_to(ROOT)} -> {value}")
                continue
            if not target.is_file():
                ERRORS.append(f"Referencia inexistente: {self.source.relative_to(ROOT)} -> {value}")


def validate_html_references() -> None:
    for source in sorted(ROOT.rglob("*.html")):
        if ".git" in source.parts or "node_modules" in source.parts:
            continue
        try:
            LocalReferences(source).feed(source.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError) as exc:
            ERRORS.append(f"No se pudo leer {source.relative_to(ROOT)}: {exc}")



def validate_json_and_toml() -> None:
    for source in sorted(ROOT.rglob("*.json")):
        if ".git" in source.parts or "node_modules" in source.parts:
            continue
        try:
            json.loads(source.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            ERRORS.append(f"JSON inválido: {source.relative_to(ROOT)}: {exc}")

    source = ROOT / "wrangler.toml"
    try:
        with source.open("rb") as handle:
            tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        ERRORS.append(f"TOML inválido: wrangler.toml: {exc}")


def validate_runtime_references() -> None:
    """Comprueba rutas literales locales usadas por el frontend.

    Las rutas construidas dinámicamente, como icons/${id}.webp, se validan
    mediante el catálogo y no se fuerzan aquí porque no contienen un nombre
    de archivo completo en el código fuente.
    """
    pattern = re.compile(r"(?:['`])((?:data|icons|img)/[A-Za-z0-9_.@/-]+\.(?:json|webp|png|jpg|jpeg|svg))(?:['`])")
    sources = [ROOT / "albion-app" / "app.js", ROOT / "albion-app" / "index.html"]
    for source in sources:
        text = source.read_text(encoding="utf-8")
        for value in pattern.findall(text):
            target = ROOT / "albion-app" / value
            if not target.is_file():
                ERRORS.append(f"Referencia local inexistente: {source.relative_to(ROOT)} -> {value}")


def validate_build_inputs() -> None:
    required = [
        "albion-app/index.html",
        "albion-app/app.js",
        "albion-app/styles.css",
        "albion-app/js",
        "albion-app/data",
        "albion-app/icons",
        "albion-app/img",
        "tools/server.py",
        "albion-exe/main.go",
        "albion-exe/go.mod",
    ]
    for value in required:
        if not (ROOT / value).exists():
            ERRORS.append(f"Entrada del build inexistente: {value}")

def main() -> int:
    validate_javascript()
    validate_python()
    validate_html_references()
    validate_json_and_toml()
    validate_runtime_references()
    validate_build_inputs()
    if ERRORS:
        print("Validación fallida:")
        print("\n".join(f"- {error}" for error in ERRORS))
        return 1
    print("Validación correcta: JavaScript, Python, JSON, TOML, referencias y entradas del build.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
