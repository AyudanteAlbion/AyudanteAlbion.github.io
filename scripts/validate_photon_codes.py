#!/usr/bin/env python3
"""Valida la tabla de códigos Photon del tracker.

La tabla (`albion-app/data/photon_codes.json`) se edita a mano después de cada
patch de Albion y la carga el ejecutable SIN recompilar, así que un error acá
rompe el tracker en producción sin que nada falle al compilar.

Antes esta comprobación vivía embebida en build.sh (que se eliminó al unificar
la app de escritorio). Ahora es un script propio que corre en el workflow de
escritorio antes de compilar el .exe.

Las reglas son las mismas que aplica desktop/internal/tracker/codes.go.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "albion-app" / "data" / "photon_codes.json"


def main() -> int:
    if not SOURCE.exists():
        print(f"ERROR: falta {SOURCE.relative_to(ROOT)}", file=sys.stderr)
        return 1
    try:
        data = json.loads(SOURCE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"ERROR: JSON inválido: {exc}", file=sys.stderr)
        return 1

    errors: list[str] = []
    seen: dict[tuple[str, int], str] = {}

    for section in ("events", "operations"):
        entries = data.get(section)
        if not isinstance(entries, dict):
            errors.append(f"falta la sección '{section}'")
            continue
        for name, value in entries.items():
            # Claves de documentación y entradas desactivadas a propósito.
            if name.startswith("_") or value is None:
                continue
            # Los códigos viajan en el parámetro 252/253 como entero de 16 bits.
            if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 65535:
                errors.append(f"{section}.{name} = {value!r} inválido (0-65535)")
                continue
            key = (section, value)
            if key in seen:
                errors.append(f"{section}.{name} repite el código {value} de '{seen[key]}'")
                continue
            seen[key] = name

    if not any(section == "events" for section, _ in seen):
        errors.append("no define ningún evento")

    for problem in errors:
        print(f"ERROR: photon_codes.json: {problem}", file=sys.stderr)
    if errors:
        return 1

    events = sum(1 for section, _ in seen if section == "events")
    operations = len(seen) - events
    print(f"OK — photon_codes.json: {events} eventos, {operations} operaciones")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
