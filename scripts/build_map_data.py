#!/usr/bin/env python3
"""Actualiza albion-app/data/albion_map_connections.json con coordenadas x,y.

Fuente: cluster/world.xml de broderickhyman/ao-bin-dumps. Cada <cluster> del
mapa del mundo (reinos + Zona Negra) trae un atributo worldmapposition="x y"
con su posición en el mapa global del juego. Los Caminos de Avalon (túneles)
no tienen posición fija: son dinámicos y quedan sin x,y.

El script NO regenera el grafo: solo agrega x,y a las entradas de maps[]
que coinciden por nombre con un cluster posicionado, así los nombres, tipos,
tiers y adyacencias existentes quedan intactos (el tracker filtra batallas
por clusterName, que debe seguir casando 1:1 con byName).

Uso:
    python3 scripts/build_map_data.py [ruta/a/world.xml]

Sin argumento descarga world.xml vía la API de GitHub (raw.githubusercontent
suele estar bloqueado; la API de contenidos sirve el blob tal cual).
"""
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

WORLD_XML_URL = ("https://api.github.com/repos/broderickhyman/ao-bin-dumps/"
                 "contents/cluster/world.xml")
REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "albion-app" / "data" / "albion_map_connections.json"
TRACKER_MAP_NAMES = REPO / "desktop" / "ui" / "data" / "tracker_map_names.json"

# zonas que siempre deberían quedar con posición (control de sanidad).
# Bancos/mercados son interiores sin posición en el mapa del mundo, y Brecilien
# + alrededores tampoco traen worldmapposition en world.xml (región de Avalon).
MUST_HAVE = ["Martlock", "Thetford", "Bridgewatch", "Fort Sterling",
             "Lymhurst", "Caerleon", "Blackthorn Quarry", "Eldon Hill",
             "Mase Knoll", "Haytor", "Swamp Cross"]


def load_world_xml():
    if len(sys.argv) > 1:
        return Path(sys.argv[1]).read_text(encoding="utf-8")
    req = urllib.request.Request(
        WORLD_XML_URL,
        headers={"Accept": "application/vnd.github.raw",
                 "User-Agent": "ayudante-albion-build"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def cluster_attributes(xml):
    """Itera los atributos de cada <cluster> de world.xml."""
    return re.findall(r"<cluster\s+([^>]+?)>", xml)


def parse_positions(xml):
    """cluster displayname -> (x, y). Solo clusters con worldmapposition."""
    pos = {}
    for attrs in cluster_attributes(xml):
        name = re.search(r'displayname="([^"]*)"', attrs)
        wmp = re.search(r'worldmapposition="([^"]*)"', attrs)
        if not name or not wmp:
            continue
        parts = wmp.group(1).split()
        if len(parts) < 2:
            continue
        try:
            x, y = float(parts[0]), float(parts[1])
        except ValueError:
            continue
        dn = name.group(1)
        if dn in pos and pos[dn] != (x, y):
            print(f"  ⚠ posición repetida y distinta para {dn}: "
                  f"{pos[dn]} vs {(x, y)}")
        pos[dn] = (x, y)
    return pos


def parse_tracker_names(xml):
    """cluster id -> displayname para los IDs que entrega Photon al tracker."""
    names = {}
    for attrs in cluster_attributes(xml):
        cluster_id = re.search(r'\bid="([^"]+)"', attrs)
        display_name = re.search(r'\bdisplayname="([^"]*)"', attrs)
        if not cluster_id or not display_name or not display_name.group(1).strip():
            continue
        names[cluster_id.group(1)] = display_name.group(1).strip()
    return dict(sorted(names.items(), key=lambda item: item[0].lower()))


def main():
    xml = load_world_xml()
    positions = parse_positions(xml)
    tracker_names = parse_tracker_names(xml)
    print(f"world.xml: {len(positions)} clusters con worldmapposition · "
          f"{len(tracker_names)} nombres para el tracker")

    data = json.loads(DATA.read_text(encoding="utf-8"))
    maps = data.get("maps", [])
    matched = 0
    by_type = {}
    for m in maps:
        p = positions.get(m.get("mapName"))
        if p is None:
            m.pop("x", None)
            m.pop("y", None)
            continue
        m["x"] = round(p[0], 2)
        m["y"] = round(p[1], 2)
        matched += 1
        by_type[m.get("mapType")] = by_type.get(m.get("mapType"), 0) + 1

    print(f"maps[]: {matched}/{len(maps)} con posición, por tipo: {by_type}")
    missing = [n for n in MUST_HAVE
               if not any(m.get("mapName") == n and "x" in m for m in maps)]
    if missing:
        print(f"  ✗ sin posición (¡revisar!): {missing}")
        sys.exit(1)

    xs = [m["x"] for m in maps if "x" in m]
    ys = [m["y"] for m in maps if "x" in m]
    print(f"bounds: x [{min(xs)}, {max(xs)}] · y [{min(ys)}, {max(ys)}]")

    DATA.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")
    # Este índice pequeño acompaña al frontend de escritorio. Así un MapIndex
    # como "0006" se presenta como "Bank of Thetford" en vez de filtrar el
    # identificador técnico que llega por Photon a la pantalla del usuario.
    TRACKER_MAP_NAMES.parent.mkdir(parents=True, exist_ok=True)
    TRACKER_MAP_NAMES.write_text(json.dumps({
        "_comment": "Índice id de cluster -> nombre visible, generado desde cluster/world.xml de broderickhyman/ao-bin-dumps. Se actualiza con scripts/build_map_data.py.",
        "source": "broderickhyman/ao-bin-dumps · cluster/world.xml",
        "generatedAt": time.strftime("%Y-%m-%d", time.gmtime()),
        "names": tracker_names,
    }, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    kb = DATA.stat().st_size / 1024
    names_kb = TRACKER_MAP_NAMES.stat().st_size / 1024
    print(f"✓ {DATA.name} actualizado ({kb:.0f} KB) · "
          f"{TRACKER_MAP_NAMES.name} ({names_kb:.0f} KB)")


if __name__ == "__main__":
    main()
