#!/usr/bin/env python3
"""Verifica o corrige los insumos encantados de Crafteo de equipo.

La app almacena las recetas listas para consultar en
``albion-app/data/gear_data.json``. El dump público de Albion conserva el
nivel de encantamiento por *recurso*, no sólo por ítem fabricado. Esta
herramienta aplica esa relación sin copiar código de herramientas externas:

* elige la primera alternativa de craftingrequirements, igual que el dataset;
* para un recurso con @enchantmentlevel busca primero ITEM@N si ese ítem tiene
  una variante encantada; y
* usa ITEM_LEVELN@N para recursos refinados que no tienen una variante directa.

Por seguridad, el script comprueba la cantidad de cada insumo y se niega a
escribir si el dump no coincide con el formato del dataset. La política de
retorno ya almacenada se preserva literalmente: no se recalcula desde el
dump, porque algunos recursos antiguos no incluyen @maxreturnamount. La fuente
por defecto es una revisión pública fija de
https://github.com/ao-data/ao-bin-dumps; se puede pasar una copia local con
--items para una comprobación completamente offline.

Uso:
    python3 scripts/validate_gear_enchantments.py --items /ruta/items.json
    python3 scripts/validate_gear_enchantments.py --items /ruta/items.json --write

Sin --write sólo valida y devuelve código 1 si hay IDs que corregir.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import urllib.request
from collections.abc import Iterable
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GEAR = ROOT / "albion-app" / "data" / "gear_data.json"
# Actualizar deliberadamente esta revisión cuando se regenere gear_data.json.
SOURCE_REPOSITORY = "ao-data/ao-bin-dumps"
SOURCE_REF = "0be6a5e74f30fc1312118be3d017f3832f027cef"
SOURCE_CONTENT_API = (
    "https://api.github.com/repos/"
    f"{SOURCE_REPOSITORY}/contents/items.json?ref={SOURCE_REF}"
)

JsonObject = dict[str, Any]


class ValidationError(Exception):
    """El dump o el dataset no son compatibles con esta actualización."""


def as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def as_positive_int(value: Any, context: str) -> int:
    try:
        result = int(str(value))
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{context}: entero inválido ({value!r})") from exc
    if result < 0:
        raise ValidationError(f"{context}: no puede ser negativo ({result})")
    return result


def as_decimal(value: Any, context: str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValidationError(f"{context}: decimal inválido ({value!r})") from exc


def load_json(path: Path) -> JsonObject:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValidationError(f"No se pudo leer {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValidationError(f"{path}: se esperaba un objeto JSON")
    return data


def download_public_items() -> tuple[JsonObject, str, str]:
    """Descarga un blob fijado por commit desde la API de GitHub.

    El endpoint Contents omite el cuerpo de archivos mayores a 1 MB. En ese
    caso entrega ``git_url`` y el endpoint Git Blobs sí devuelve el mismo
    archivo base64 completo.
    """
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "ayudante-albion-gear-validator",
    }

    def fetch_payload(url: str) -> JsonObject:
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=90) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValidationError("La API de GitHub devolvió una respuesta inesperada")
        return payload

    try:
        payload = fetch_payload(SOURCE_CONTENT_API)
        if payload.get("encoding") != "base64":
            git_url = payload.get("git_url")
            if not isinstance(git_url, str) or not git_url.startswith(
                f"https://api.github.com/repos/{SOURCE_REPOSITORY}/git/blobs/"
            ):
                raise ValidationError("La API no devolvió el blob esperado de items.json")
            payload = fetch_payload(git_url)

        encoded = payload.get("content", "")
        if payload.get("encoding") != "base64" or not isinstance(encoded, str):
            raise ValidationError("La API no devolvió items.json codificado en base64")
        raw = base64.b64decode(encoded)
        return (
            json.loads(raw),
            f"{SOURCE_REPOSITORY}@{SOURCE_REF}",
            hashlib.sha256(raw).hexdigest(),
        )
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise ValidationError(
            "No se pudo descargar el dump público fijado. "
            "Usá --items /ruta/items.json para validarlo offline."
        ) from exc


def collect_item_definitions(value: Any, output: dict[str, JsonObject]) -> None:
    """Indexa sólo las definiciones completas, no los nodos craftresource."""
    if isinstance(value, dict):
        unique_name = value.get("@uniquename")
        if isinstance(unique_name, str) and (
            "craftingrequirements" in value or "enchantments" in value
        ):
            output[unique_name] = value
        for child in value.values():
            collect_item_definitions(child, output)
    elif isinstance(value, list):
        for child in value:
            collect_item_definitions(child, output)


def selected_requirements(item: JsonObject, enchantment: int, recipe_id: str) -> JsonObject:
    """Devuelve la primera receta del nivel que representa gear_data.json."""
    if enchantment:
        enchantments = item.get("enchantments")
        entries = as_list(enchantments.get("enchantment") if isinstance(enchantments, dict) else None)
        selected = next(
            (
                entry
                for entry in entries
                if isinstance(entry, dict)
                and as_positive_int(entry.get("@enchantmentlevel"), recipe_id) == enchantment
            ),
            None,
        )
        if selected is None:
            raise ValidationError(f"{recipe_id}: no existe el encantamiento .{enchantment} en el dump")
        requirements = as_list(selected.get("craftingrequirements"))
    else:
        requirements = as_list(item.get("craftingrequirements"))

    if not requirements or not isinstance(requirements[0], dict):
        raise ValidationError(f"{recipe_id}: no hay craftingrequirements utilizables")
    return requirements[0]


def item_has_direct_enchantment(
    definitions: dict[str, JsonObject], unique_name: str, enchantment: int
) -> bool:
    """Determina si el ID de mercado correcto es ITEM@N y no ITEM_LEVELN@N."""
    item = definitions.get(unique_name)
    enchantments = item.get("enchantments") if item else None
    entries = as_list(enchantments.get("enchantment") if isinstance(enchantments, dict) else None)
    return any(
        isinstance(entry, dict)
        and as_positive_int(entry.get("@enchantmentlevel"), unique_name) == enchantment
        for entry in entries
    )


def resolved_resource_id(
    source_resource: JsonObject, definitions: dict[str, JsonObject], recipe_id: str
) -> str:
    """Convierte el ID de recurso de dump al ID requerido por mercado/render."""
    unique_name = source_resource.get("@uniquename")
    if not isinstance(unique_name, str) or not unique_name:
        raise ValidationError(f"{recipe_id}: recurso sin @uniquename")

    enchantment = as_positive_int(
        source_resource.get("@enchantmentlevel", 0), f"{recipe_id}/{unique_name}"
    )
    if not enchantment or "@" in unique_name:
        return unique_name

    # Capas y equipo (incluido el equipo base de recetas Real) tienen su forma
    # directa ITEM@N. Los materiales refinados llegan como ITEM_LEVELN y sólo
    # requieren el sufijo de mercado; si un dump antiguo usara la raíz, se usa
    # el fallback ITEM_LEVELN@N.
    if item_has_direct_enchantment(definitions, unique_name, enchantment):
        return f"{unique_name}@{enchantment}"
    if "_LEVEL" in unique_name:
        return f"{unique_name}@{enchantment}"
    return f"{unique_name}_LEVEL{enchantment}@{enchantment}"


def same_number(left: Any, right: Any, context: str) -> bool:
    return as_decimal(left, context) == as_decimal(right, context)


def recipe_metadata(recipe: JsonObject) -> JsonObject:
    """Metadatos para mostrar un ingrediente directo sin caer al ID técnico."""
    return {
        "name_en": recipe.get("name_en", recipe["id"]),
        "name_es": recipe.get("name_es", recipe["id"]),
        "itemvalue": recipe.get("itemvalue", 0),
    }


def validate_and_optionally_apply(
    gear: JsonObject, source: JsonObject, write: bool
) -> tuple[int, int]:
    recipes = gear.get("recipes")
    ingredients = gear.get("ingredients")
    if not isinstance(recipes, list) or not isinstance(ingredients, dict):
        raise ValidationError("gear_data.json no tiene recipes[] e ingredients{}")

    definitions: dict[str, JsonObject] = {}
    collect_item_definitions(source, definitions)
    recipe_by_id = {
        recipe.get("id"): recipe
        for recipe in recipes
        if isinstance(recipe, dict) and isinstance(recipe.get("id"), str)
    }
    if len(recipe_by_id) != len(recipes):
        raise ValidationError("gear_data.json contiene recetas sin ID o IDs repetidos")

    corrections: list[tuple[str, JsonObject, str]] = []
    metadata_to_add: dict[str, JsonObject] = {}

    for recipe in recipes:
        recipe_id = recipe["id"]
        base = recipe.get("base")
        if not isinstance(base, str) or not base:
            raise ValidationError(f"{recipe_id}: base ausente")
        enchantment = as_positive_int(recipe.get("ench", 0), recipe_id)
        source_item = definitions.get(base)
        if source_item is None:
            raise ValidationError(f"{recipe_id}: base {base} ausente en items.json")

        requirements = selected_requirements(source_item, enchantment, recipe_id)
        source_resources = as_list(requirements.get("craftresource"))
        actual_resources = recipe.get("resources")
        if not isinstance(actual_resources, list):
            raise ValidationError(f"{recipe_id}: resources no es una lista")
        if len(source_resources) != len(actual_resources):
            raise ValidationError(
                f"{recipe_id}: {len(actual_resources)} recursos en gear_data, "
                f"{len(source_resources)} en el dump"
            )

        for index, (source_resource, actual_resource) in enumerate(
            zip(source_resources, actual_resources, strict=True)
        ):
            context = f"{recipe_id}/recurso {index + 1}"
            if not isinstance(source_resource, dict) or not isinstance(actual_resource, dict):
                raise ValidationError(f"{context}: recurso inválido")
            expected_id = resolved_resource_id(source_resource, definitions, recipe_id)
            source_count = source_resource.get("@count")
            if source_count is None or not same_number(source_count, actual_resource.get("count"), context):
                raise ValidationError(f"{context}: la cantidad no coincide con el dump")
            # P0 sólo corrige el identificador que se cotiza. `ret` se conserva
            # exactamente como ya está en gear_data: los dumps no expresan ese
            # atributo de forma uniforme para recursos viejos.
            if not isinstance(actual_resource.get("ret"), bool):
                raise ValidationError(f"{context}: ret debe ser booleano")
            if actual_resource.get("id") != expected_id:
                corrections.append((recipe_id, actual_resource, expected_id))

            target_recipe = recipe_by_id.get(expected_id)
            if target_recipe is not None and expected_id not in ingredients:
                metadata_to_add[expected_id] = recipe_metadata(target_recipe)

    if write:
        for _, actual_resource, expected_id in corrections:
            actual_resource["id"] = expected_id
        ingredients.update(metadata_to_add)

    return len(corrections), len(metadata_to_add)


def assert_p0_regressions(gear: JsonObject) -> None:
    """Casos de aceptación que no deben volver a romperse al regenerar datos."""
    recipes = gear["recipes"]
    recipe_by_id = {recipe["id"]: recipe for recipe in recipes}

    brecilien = recipe_by_id.get("T8_CAPEITEM_FW_BRECILIEN@4")
    expected_brecilien = [
        {"id": "T8_CAPE@4", "count": 1, "ret": False},
        {"id": "T8_CAPEITEM_FW_BRECILIEN_BP", "count": 1, "ret": False},
        {"id": "QUESTITEM_TOKEN_MISTS", "count": 10, "ret": False},
    ]
    if brecilien is None or brecilien.get("resources") != expected_brecilien:
        raise ValidationError(
            "Caso P0 incumplido: T8_CAPEITEM_FW_BRECILIEN@4 debe pedir "
            "T8_CAPE@4, insignia sin encantamiento y 10 tokens"
        )

    # Todo equipo Real encantado del dataset necesita su equipo normal de la
    # misma variante. Los tokens no se encantan ni se vuelven retornables.
    royal_recipes = [
        recipe
        for recipe in recipes
        if isinstance(recipe.get("base"), str)
        and recipe["base"].endswith("_ROYAL")
        and as_positive_int(recipe.get("ench", 0), recipe["id"]) > 0
    ]
    if not royal_recipes:
        raise ValidationError("No se encontraron recetas Real encantadas")
    for recipe in royal_recipes:
        level = recipe["ench"]
        resources = recipe.get("resources", [])
        if (
            len(resources) < 2
            or resources[0].get("id", "").endswith(f"@{level}") is False
            or "_SET" not in resources[0].get("id", "")
            or resources[0].get("ret") is not False
            or resources[1].get("ret") is not False
            or "TOKEN" not in resources[1].get("id", "")
            or "@" in resources[1].get("id", "")
        ):
            raise ValidationError(f"Caso P0 incumplido para equipo Real: {recipe['id']}")

    # La receta estándar de control verifica que P0 no cambie el formato de
    # los materiales refinados ni su retorno.
    standard = recipe_by_id.get("T8_ARMOR_PLATE_SET1@4")
    if standard is None or standard.get("resources") != [
        {"id": "T8_METALBAR_LEVEL4@4", "count": 16, "ret": True}
    ]:
        raise ValidationError("Caso P0 incumplido: T8_ARMOR_PLATE_SET1@4")

    ingredients = gear.get("ingredients", {})
    if "T8_CAPE@4" not in ingredients:
        raise ValidationError("Faltan metadatos de ingrediente para T8_CAPE@4")


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--items",
        type=Path,
        help="items.json público local; evita la descarga desde GitHub",
    )
    parser.add_argument(
        "--gear",
        type=Path,
        default=DEFAULT_GEAR,
        help=f"dataset de equipo (por defecto: {DEFAULT_GEAR.relative_to(ROOT)})",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="aplica las correcciones al dataset; sin esta opción sólo valida",
    )
    return parser.parse_args(list(argv))


def main(argv: Iterable[str] = sys.argv[1:]) -> int:
    args = parse_args(argv)
    gear_path = args.gear.resolve()
    gear = load_json(gear_path)

    if args.items:
        source_path = args.items.resolve()
        source = load_json(source_path)
        source_label = str(source_path)
        source_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
    else:
        source, source_label, source_hash = download_public_items()

    corrections, metadata_count = validate_and_optionally_apply(gear, source, args.write)
    if args.write:
        assert_p0_regressions(gear)
        gear_path.write_text(
            json.dumps(gear, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        print(
            f"✓ {gear_path.name}: {corrections} IDs de recursos corregidos; "
            f"{metadata_count} metadatos de ingredientes agregados."
        )
        print(f"  Fuente: {source_label} (sha256 {source_hash})")
        return 0

    if corrections or metadata_count:
        parts: list[str] = []
        if corrections:
            parts.append(f"{corrections} IDs de recursos encantados")
        if metadata_count:
            parts.append(f"{metadata_count} metadatos de ingredientes")
        print(
            f"✗ {gear_path.name}: faltan corregir/agregar " + " y ".join(parts) +
            ". Ejecutá de nuevo con --write."
        )
        return 1

    assert_p0_regressions(gear)
    print(
        f"✓ {gear_path.name}: los IDs de todas las recetas coinciden con el dump "
        f"y existen sus metadatos de ingredientes ({source_label}; sha256 {source_hash})."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValidationError as exc:
        print(f"✗ Validación de recetas: {exc}", file=sys.stderr)
        raise SystemExit(2)
