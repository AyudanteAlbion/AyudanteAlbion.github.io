#!/usr/bin/env python3
"""Genera desktop/internal/tracker/cluster_kinds.json.

El protocolo no dice qué es cada cluster: para las instancias el token viaja
en la propia cadena ("@RANDOMDUNGEON@<guid>"), pero las mazmorras estáticas,
los hellgates, las expediciones y los Caminos de Avalon son clusters normales
cuyo índice ("DNG-KPR-02-MAIN-010") no revela el tipo. La aplicación de
referencia (SAT) resuelve esos índices contra `world.json` de ao-bin-dumps;
este script produce el equivalente embebido en el binario.

Fuente: cluster/world.xml de ao-data/ao-bin-dumps. Cada <cluster> trae
`id`, `type` y `file`; el tier y el nivel (Q1..Q6 de las estáticas negras)
salen del nombre del archivo ("..._T5_KPR_OUT_Q1.cluster.xml").

Uso:
    python3 scripts/build_cluster_kinds.py [ruta/a/world.xml]

Sin argumentos descarga world.xml vía la API de GitHub (raw.githubusercontent
suele estar bloqueado; la API de contenidos sirve el blob tal cual, igual que
en scripts/build_map_data.py).
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

WORLD_XML_URL = ("https://api.github.com/repos/ao-data/ao-bin-dumps/"
                 "contents/cluster/world.xml")
REPO = Path(__file__).resolve().parent.parent
OUTPUT = REPO / "desktop" / "internal" / "tracker" / "cluster_kinds.json"

# type de world.xml -> clave que entiende dungeonKind (Go). Las que faltan
# (OPENPVP_*, SAFEAREA, PLAYERCITY_*, STARTAREA, PASSAGE_*) son zonas abiertas
# y no necesitan entrada: el tracker las trata como "no mazmorra" por defecto.
#
# CORRUPTED_DUNGEON_INTERMEDIATE es el vestíbulo abierto de las corruptas: la
# partida real es la instancia "@CORRUPTEDDUNGEON@<guid>", así que no abre run.
WORLD_TYPES = {
    "DUNGEON_SAFEAREA": "static",
    "DUNGEON_YELLOW": "static",
    "DUNGEON_RED": "static",
    "DUNGEON_BLACK_1": "static",
    "DUNGEON_BLACK_2": "static",
    "DUNGEON_BLACK_3": "static",
    "DUNGEON_BLACK_4": "static",
    "DUNGEON_BLACK_5": "static",
    "DUNGEON_BLACK_6": "static",
    "DUNGEON_HELL_2V2_NON_LETHAL": "hellgate",
    "DUNGEON_HELL_2V2_LETHAL": "hellgate",
    "DUNGEON_HELL_5V5_NON_LETHAL": "hellgate",
    "DUNGEON_HELL_5V5_LETHAL": "hellgate",
    "DUNGEON_HELL_10V10_NON_LETHAL": "hellgate",
    "DUNGEON_HELL_10V10_LETHAL": "hellgate",
    "HARDCORE_EXPEDITION_STANDARD": "hce",
    "HARDCORE_EXPEDITION_SURFACE": "hce",
    "T3_EXPEDITION_STANDARD": "hce",
    "T3_EXPEDITION_SURFACE": "hce",
    "T4_EXPEDITION_STANDARD": "hce",
    "T4_EXPEDITION_SURFACE": "hce",
    "T5_EXPEDITION_STANDARD": "hce",
    "T5_EXPEDITION_SURFACE": "hce",
    "T6_EXPEDITION_STANDARD": "hce",
    "T6_EXPEDITION_SURFACE": "hce",
    "TUNNEL_LOW": "avalon",
    "TUNNEL_MEDIUM": "avalon",
    "TUNNEL_HIGH": "avalon",
    "TUNNEL_ROYAL": "avalon",
    "TUNNEL_ROYAL_RED": "avalon",
    "TUNNEL_BLACK_LOW": "avalon",
    "TUNNEL_BLACK_MEDIUM": "avalon",
    "TUNNEL_BLACK_HIGH": "avalon",
    "TUNNEL_DEEP": "avalon",
    "TUNNEL_DEEP_RAID": "avalon",
    "TUNNEL_HIDEOUT": "avalon",
    "TUNNEL_HIDEOUT_DEEP": "avalon",
    "ARENA_1V1": "arena",
    "ARENA_STANDARD": "arena",
    "ARENA_CUSTOM": "arena",
    "ARENA_CRYSTAL": "arena",
    "ARENA_CRYSTAL_20VS20": "arena",
    "ARENA_CRYSTAL_NONLETHAL": "arena",
    "PLAYERISLAND": "island",
    "GUILDISLAND": "island",
    "SHOWROOMISLAND": "island",
    "HIDEOUT": "hideout",
}

TIER_RE = re.compile(r"_T([1-8])_")
LEVEL_RE = re.compile(r"_OUT_Q([1-6])(?:_|\.|$)")


def fetch_world_xml() -> bytes:
    request = urllib.request.Request(
        WORLD_XML_URL, headers={"Accept": "application/vnd.github.raw+json",
                                "User-Agent": "ayudante-albion-build-script"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except Exception as exc:  # noqa: BLE001 - reintenta y reporta al final
            if attempt == 2:
                raise SystemExit(f"No se pudo descargar world.xml: {exc}")
            time.sleep(2 * (attempt + 1))
    raise SystemExit("No se pudo descargar world.xml")


def parse_world(xml: bytes) -> dict:
    root = ET.fromstring(xml)
    clusters = root.find("clusters")
    if clusters is None:
        raise SystemExit("world.xml sin sección <clusters>")

    out: dict[str, dict] = {}
    for cluster in clusters.findall("cluster"):
        cluster_id = (cluster.get("id") or "").strip()
        world_type = (cluster.get("type") or "").strip()
        file_name = (cluster.get("file") or "").strip()
        if not cluster_id or cluster_id in out:
            continue
        kind = WORLD_TYPES.get(world_type)
        if not kind:
            continue
        # Los ids DNG-MISTS-* son las mazmorras de las Nieblas: la app de
        # referencia (WorldData.IsStaticDungeon) las excluye de las estáticas.
        if kind == "static" and cluster_id.upper().startswith("DNG-MISTS-"):
            continue
        tier = TIER_RE.search(file_name)
        level = LEVEL_RE.search(file_name)
        entry = {"k": kind}
        if tier:
            entry["t"] = int(tier.group(1))
        if level:
            entry["q"] = int(level.group(1))
        out[cluster_id] = entry
    return out


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else None
    if path:
        xml = Path(path).read_bytes()
    else:
        xml = fetch_world_xml()
    entries = parse_world(xml)
    if len(entries) < 100:
        raise SystemExit(f"Solo {len(entries)} clusters reconocidos: world.xml "
                         "cambió de formato y el script hay que revisarlo.")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "_comment": [
            "Índice id de cluster -> tipo de contenido, generado desde",
            "cluster/world.xml de ao-data/ao-bin-dumps (el mismo dato que SAT",
            "carga como world.json). Regenerar con",
            "scripts/build_cluster_kinds.py tras cada patch del juego.",
            "",
            "Claves de cada entrada: k = tipo (static, hellgate, hce, avalon,",
            "arena, island, hideout), t = tier, q = nivel Q1..Q6 de estáticas.",
            "Las zonas abiertas no tienen entrada: no son mazmorra.",
        ],
        "source": "ao-data/ao-bin-dumps · cluster/world.xml",
        "generatedAt": time.strftime("%Y-%m-%d"),
        "clusters": dict(sorted(entries.items())),
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n",
                      encoding="utf-8")
    by_kind: dict[str, int] = {}
    for entry in entries.values():
        by_kind[entry["k"]] = by_kind.get(entry["k"], 0) + 1
    summary = ", ".join(f"{k}={v}" for k, v in sorted(by_kind.items()))
    print(f"OK — cluster_kinds.json: {len(entries)} clusters ({summary})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
