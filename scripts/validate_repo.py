#!/usr/bin/env python3
"""Validaciones pequeñas y sin dependencias externas para el repositorio."""
from __future__ import annotations

import html.parser
import json
import re
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
ERRORS: list[str] = []

# desktop/frontend/ lo genera desktop/sync_frontend.sh copiando desktop/ui/ y
# los assets de albion-app/. Es contenido derivado y no versionado: validarlo
# duplicaría cada archivo (y sus errores) contra su fuente real.
GENERATED = {"node_modules", "__pycache__", ".git"}


def is_generated(path: Path) -> bool:
    parts = path.parts
    if GENERATED.intersection(parts):
        return True
    return "desktop" in parts and "frontend" in parts


def run(command: list[str], label: str) -> None:
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    if result.returncode:
        detail = (result.stdout + result.stderr).strip()
        ERRORS.append(f"{label}: {detail or 'falló'}")


def validate_javascript() -> None:
    files = sorted(
        path for path in ROOT.rglob("*.js") if not is_generated(path)
    )
    for path in files:
        text = path.read_text(encoding="utf-8")
        # worker/index.js es un módulo ESM (Cloudflare Workers usa `export`).
        # Node 22 puede detectarlo aunque package.json no declare `type`, pero
        # Node 18/20 en CI no siempre. Validarlo como .mjs mantiene la suite
        # portable sin cambiar cómo se publica el Worker.
        if re.search(r"^\s*export\s+", text, re.MULTILINE):
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".mjs", delete=False) as handle:
                handle.write(text)
                temp_name = handle.name
            try:
                run(["node", "--check", temp_name], f"JavaScript inválido: {path.relative_to(ROOT)}")
            finally:
                Path(temp_name).unlink(missing_ok=True)
        else:
            run(["node", "--check", str(path)], f"JavaScript inválido: {path.relative_to(ROOT)}")


def validate_python() -> None:
    files = sorted(
        path for path in ROOT.rglob("*.py") if not is_generated(path)
    )
    if files:
        run([sys.executable, "-m", "py_compile", *map(str, files)], "Python inválido")


# Assets compartidos: desktop/ui/ es un fork del frontend de la web, pero
# data/, icons/ e img/ NO se duplican — los copia sync_frontend.sh desde
# albion-app/ al compilar. Al validar desktop/ui/ hay que resolver esas rutas
# contra la fuente compartida, o cada <img src="img/..."> daría un falso error.
SHARED_ASSETS = ("data/", "icons/", "img/")


def resolve_reference(source: Path, path: str) -> Path:
    """Resuelve una ruta relativa teniendo en cuenta los assets compartidos."""
    target = (source.parent / path).resolve()
    if target.is_file():
        return target
    try:
        relative = source.relative_to(ROOT / "desktop" / "ui")
    except ValueError:
        return target
    _ = relative
    clean = path.lstrip("./")
    if clean.startswith(SHARED_ASSETS):
        return (ROOT / "albion-app" / clean).resolve()
    return target


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
            target = resolve_reference(self.source, parsed.path)
            try:
                target.relative_to(ROOT.resolve())
            except ValueError:
                ERRORS.append(f"Referencia fuera del repo: {self.source.relative_to(ROOT)} -> {value}")
                continue
            if not target.is_file():
                ERRORS.append(f"Referencia inexistente: {self.source.relative_to(ROOT)} -> {value}")


def validate_html_references() -> None:
    for source in sorted(ROOT.rglob("*.html")):
        if is_generated(source):
            continue
        try:
            LocalReferences(source).feed(source.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError) as exc:
            ERRORS.append(f"No se pudo leer {source.relative_to(ROOT)}: {exc}")



def validate_json_and_toml() -> None:
    for source in sorted(ROOT.rglob("*.json")):
        if is_generated(source):
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
    # La web y el fork del escritorio se validan por igual: si el frontend
    # del escritorio referencia un asset que no existe, CI lo marca.
    sources = [
        ROOT / "albion-app" / "app.js",
        ROOT / "albion-app" / "index.html",
        ROOT / "desktop" / "ui" / "app.js",
        ROOT / "desktop" / "ui" / "index.html",
    ]
    for source in sources:
        if not source.is_file():
            ERRORS.append(f"Falta el frontend esperado: {source.relative_to(ROOT)}")
            continue
        text = source.read_text(encoding="utf-8")
        for value in pattern.findall(text):
            if not resolve_reference(source, value).is_file():
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
        # App de escritorio: frontend forkeado + backend Go.
        "desktop/ui/index.html",
        "desktop/ui/app.js",
        "desktop/ui/styles.css",
        "desktop/ui/js",
        "desktop/main.go",
        "desktop/go.mod",
    ]
    for value in required:
        if not (ROOT / value).exists():
            ERRORS.append(f"Entrada del build inexistente: {value}")

def validate_photon_codes() -> None:
    """Valida la tabla de códigos Photon del tracker.

    La tabla se edita a mano después de cada patch de Albion y la carga el
    ejecutable sin recompilar, así que un error acá rompe el tracker en
    producción sin que nadie lo note al compilar. Estas reglas son las mismas
    que aplica `desktop/internal/tracker/codes.go` al cargarla.
    """
    source = ROOT / "albion-app" / "data" / "photon_codes.json"
    if not source.exists():
        ERRORS.append("Falta albion-app/data/photon_codes.json (tabla del tracker)")
        return
    try:
        data = json.loads(source.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        ERRORS.append(f"photon_codes.json: JSON inválido: {exc}")
        return

    def check_codes(kind: str, section: str) -> dict[int, str]:
        seen: dict[int, str] = {}
        entries = data.get(section)
        if not isinstance(entries, dict):
            ERRORS.append(f"photon_codes.json: falta la sección '{section}'")
            return seen
        for name, value in entries.items():
            if name.startswith("_"):
                continue  # clave de documentación
            if value is None:
                continue  # entrada desactivada a propósito
            if not isinstance(value, int) or isinstance(value, bool):
                ERRORS.append(f"photon_codes.json: {kind} '{name}' no es un número")
                continue
            # Los códigos viajan en el parámetro 252/253 como entero de 16 bits.
            if not 0 <= value <= 65535:
                ERRORS.append(
                    f"photon_codes.json: {kind} '{name}' = {value} fuera de rango (0-65535)"
                )
                continue
            if value in seen:
                ERRORS.append(
                    f"photon_codes.json: {kind} '{name}' repite el código {value} de '{seen[value]}'"
                )
                continue
            seen[value] = name
        return seen

    events = check_codes("evento", "events")
    operations = check_codes("operación", "operations")
    if not events:
        ERRORS.append("photon_codes.json: no define ningún evento")

    # Los índices de parámetro sí son un byte del diccionario Photon.
    params = data.get("eventParameters", {})
    if isinstance(params, dict):
        for event, fields in params.items():
            if event.startswith("_"):
                continue
            if event not in data.get("events", {}) and event not in data.get("operations", {}):
                ERRORS.append(
                    f"photon_codes.json: eventParameters define '{event}', que no es un evento conocido"
                )
                continue
            if not isinstance(fields, dict):
                ERRORS.append(f"photon_codes.json: eventParameters['{event}'] debe ser un objeto")
                continue
            for field, index in fields.items():
                if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index <= 255:
                    ERRORS.append(
                        f"photon_codes.json: índice inválido en {event}.{field} = {index!r} (0-255)"
                    )

    self_op = data.get("selfOperation", {})
    if isinstance(self_op, dict):
        name = self_op.get("operation")
        if name and name not in data.get("operations", {}):
            ERRORS.append(
                f"photon_codes.json: selfOperation apunta a '{name}', que no está en 'operations'"
            )

    keys = data.get("parameterKeys", {})
    if isinstance(keys, dict):
        for key in ("eventCode", "operationCode"):
            value = keys.get(key)
            if value is not None and (not isinstance(value, int) or not 0 <= value <= 255):
                ERRORS.append(f"photon_codes.json: parameterKeys.{key} = {value!r} inválido (0-255)")

    _ = operations


def validate_tracker_safety() -> None:
    """Evita que cambios futuros eliminen límites básicos del tracker.

    No demuestra cumplimiento legal, pero vuelve visibles en CI las regresiones
    técnicas más peligrosas: inyección, acceso al proceso, overlay y pérdida
    del filtro propio/party.
    """
    desktop = ROOT / "desktop"
    sources = "\n".join(
        path.read_text(encoding="utf-8", errors="ignore")
        for path in desktop.rglob("*")
        if path.is_file() and path.suffix in {".go", ".js", ".json"} and not is_generated(path)
    )
    forbidden = {
        "pcap_sendpacket": "envío de paquetes",
        "pcap_inject": "inyección de paquetes",
        "WriteProcessMemory": "escritura de memoria del juego",
        "ReadProcessMemory": "lectura de memoria del juego",
        "SendInput": "automatización de entradas",
        "WindowSetAlwaysOnTop": "overlay/ventana siempre visible",
    }
    for symbol, description in forbidden.items():
        if symbol in sources:
            ERRORS.append(f"Tracker: se detectó {description} ({symbol}); requiere revisión de cumplimiento")

    live = (desktop / "internal" / "tracker" / "live.go").read_text(encoding="utf-8")
    required_guards = {
        "if !h.trackingAllowed()": "identidad local/filtro antes de métricas",
        "!source.InParty": "membresía GUID de party para combate",
        "h.entities.PartyByName(looter)": "resolución de botín contra party identificada",
        "h.st.AddLoot(entry)": "guardia de estado para aceptar botín",
        'case "PartyPlayerLeft"': "baja de integrantes que salen de la party",
    }
    for marker, description in required_guards.items():
        if marker not in live:
            ERRORS.append(f"Tracker: falta {description}")


def main() -> int:
    validate_javascript()
    validate_python()
    validate_html_references()
    validate_json_and_toml()
    validate_runtime_references()
    validate_build_inputs()
    validate_photon_codes()
    validate_tracker_safety()
    if ERRORS:
        print("Validación fallida:")
        print("\n".join(f"- {error}" for error in ERRORS))
        return 1
    print("Validación correcta: JavaScript, Python, JSON, TOML, referencias y entradas del build.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
