#!/usr/bin/env python3
"""Genera desktop/ui/data/tracker_gathering_items.json.

Albion no manda el nombre del recurso recolectado: el evento HarvestFinished
trae un **índice numérico** de ítem (por ejemplo 1000). Ese índice es la
posición del ítem en items.xml, y es exactamente la clave que usa la app de
referencia (SAT) en `ItemController.GetItemByIndex`.

Fuente: `formatted/items.txt` de ao-data/ao-bin-dumps, una línea por ítem con
el formato `índice: UNIQUE_NAME : Nombre visible`. Los nombres en español
salen de `formatted/items.json` (`LocalizedNames["ES-ES"]`), que es el mismo
volcado pero con todos los idiomas.

El índice resultante se limita a lo que se puede **recolectar** (madera, fibra,
mineral, piel, piedra y pesca, con sus variantes encantadas): 174 filas contra
12.237 del volcado completo, así que el archivo queda en pocas decenas de KB
y viaja con el frontend de escritorio sin inflar el paquete.

Uso:
    python3 scripts/build_gathering_items.py [ruta/a/items.txt] [ruta/a/items.json]

Sin argumentos descarga los dos archivos por la API de GitHub
(raw.githubusercontent suele estar bloqueado; la API de contenidos sirve el
blob tal cual, igual que en scripts/build_map_data.py).
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUTPUT = REPO / "desktop" / "ui" / "data" / "tracker_gathering_items.json"

ITEMS_TXT_URL = ("https://api.github.com/repos/ao-data/ao-bin-dumps/"
                 "contents/formatted/items.txt")
ITEMS_JSON_URL = ("https://api.github.com/repos/ao-data/ao-bin-dumps/"
                  "contents/formatted/items.json")

# Familia de UniqueName -> tipo que muestra la pestaña Recolección. Las claves
# de la derecha son las mismas que usa ui/js/tracker/gathering.js.
RAW_FAMILIES = {
    "WOOD": "wood",
    "FIBER": "fiber",
    "ORE": "ore",
    "HIDE": "hide",
    "ROCK": "stone",
}

# `T4_ORE`, `T4_ORE_LEVEL1@1`, `T5_WOOD_LEVEL3@3`… El tier es el número tras la
# T y el encantamiento el que sigue a la arroba (0 si no viene).
RAW_RE = re.compile(r"^T([1-8])_([A-Z]+)(?:_LEVEL(\d))?(?:@(\d))?$")
FISH_RE = re.compile(r"^T([1-8])_FISH_")
LINE_RE = re.compile(r"^\s*(\d+):\s*(\S+)\s*(?::\s*(.*))?$")

# Control de sanidad: si el volcado cambia de forma y estas filas dejan de
# salir, el índice quedaría mudo justo para los recursos más comunes.
MUST_HAVE = ["T4_ORE", "T5_WOOD", "T6_HIDE", "T4_FIBER", "T5_ROCK",
             "T4_ORE_LEVEL1@1"]


def fetch(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/vnd.github.raw",
                 "User-Agent": "ayudante-albion-build"})
    with urllib.request.urlopen(request, timeout=300) as response:
        return response.read().decode("utf-8")


def load_source(argv_index: int, url: str) -> str:
    if len(sys.argv) > argv_index:
        return Path(sys.argv[argv_index]).read_text(encoding="utf-8")
    return fetch(url)


def parse_items_txt(text: str) -> list[tuple[int, str, str]]:
    """(índice, UniqueName, nombre en inglés) por cada línea del volcado."""
    rows = []
    unparsed = 0
    for line in text.splitlines():
        if not line.strip():
            continue
        match = LINE_RE.match(line)
        if not match:
            unparsed += 1
            continue
        rows.append((int(match.group(1)), match.group(2),
                     (match.group(3) or "").strip()))
    if unparsed:
        print(f"  ⚠ {unparsed} líneas no reconocidas en items.txt")
    return rows


def classify(unique_name: str) -> tuple[str, int, int] | None:
    """UniqueName -> (tipo, tier, encantamiento). None si no se recolecta."""
    match = RAW_RE.match(unique_name)
    if match and match.group(2) in RAW_FAMILIES:
        return (RAW_FAMILIES[match.group(2)], int(match.group(1)),
                int(match.group(4) or 0))
    match = FISH_RE.match(unique_name)
    if match:
        return "fishing", int(match.group(1)), 0
    return None


def spanish_names(text: str) -> dict[str, str]:
    """UniqueName -> nombre en español, desde formatted/items.json."""
    names = {}
    for item in json.loads(text):
        unique = item.get("UniqueName")
        localized = item.get("LocalizedNames") or {}
        value = (localized.get("ES-ES") or "").strip()
        if unique and value:
            names[unique] = value
    return names


def main() -> int:
    items_txt = load_source(1, ITEMS_TXT_URL)
    rows = parse_items_txt(items_txt)
    print(f"items.txt: {len(rows)} ítems en el volcado")

    try:
        localized = spanish_names(load_source(2, ITEMS_JSON_URL))
        print(f"items.json: {len(localized)} nombres en español")
    except Exception as exc:  # pragma: no cover - depende de la red
        print(f"  ⚠ sin nombres en español ({exc}); se usa el inglés")
        localized = {}

    index: dict[str, dict] = {}
    by_type: dict[str, int] = {}
    for item_index, unique, english in rows:
        classified = classify(unique)
        if classified is None:
            continue
        kind, tier, enchantment = classified
        entry = {"n": localized.get(unique) or english or unique, "t": kind}
        if tier:
            entry["r"] = tier
        if enchantment:
            entry["e"] = enchantment
        index[str(item_index)] = entry
        by_type[kind] = by_type.get(kind, 0) + 1

    print(f"recolectables: {len(index)} · por tipo: {by_type}")

    missing = [name for name in MUST_HAVE
               if not any(unique == name for _, unique, _ in rows)]
    if missing:
        print(f"  ✗ faltan recursos esperados (¡revisar el volcado!): {missing}")
        return 1
    if not index:
        print("  ✗ el índice quedó vacío")
        return 1

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({
        "_comment": ("Índice de ítem de Albion -> recurso recolectable. La clave es el "
                     "índice numérico que manda HarvestFinished (posición del ítem en "
                     "items.xml, igual que ItemController.GetItemByIndex de SAT). "
                     "n=nombre, t=tipo, r=tier, e=encantamiento. "
                     "Se regenera con scripts/build_gathering_items.py."),
        "source": "ao-data/ao-bin-dumps · formatted/items.txt + formatted/items.json",
        "generatedAt": time.strftime("%Y-%m-%d", time.gmtime()),
        "items": index,
    }, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"✓ {OUTPUT.relative_to(REPO)} ({OUTPUT.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
