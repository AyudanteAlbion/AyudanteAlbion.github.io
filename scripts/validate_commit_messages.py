#!/usr/bin/env python3
"""Valida la convención de mensajes de commit del repositorio.

El asunto identifica el elemento de primer nivel que cambió: un archivo raíz
usa su nombre y cualquier archivo dentro de una carpeta usa el nombre de esa
carpeta. Varios elementos se separan por coma y en orden alfabético.
"""
from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")
GENERATED_PREFIXES = ("Merge ", "Revert ", "fixup! ", "squash! ")
DIFF_FILTER = "ACDMRT"


def git(args: list[str]) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError((result.stdout + result.stderr).strip() or "git falló")
    return result.stdout


def top_level_items(paths: list[str]) -> set[str]:
    """Convierte rutas en el nombre raíz mostrado por la convención."""
    items = set()
    for path in paths:
        parts = Path(path).parts
        if parts:
            items.add(parts[0])
    return items


def expected_items(paths: list[str]) -> set[str]:
    return top_level_items([p for p in paths if p])


def parse_message(message: str, strip_comments: bool = False) -> tuple[str, bool]:
    lines = message.splitlines()
    if strip_comments:
        lines = [line for line in lines if not line.lstrip().startswith("#")]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return "", False
    return lines[0].strip(), any(line.strip() for line in lines[1:])


def split_items(subject: str) -> list[str]:
    if not subject:
        raise ValueError("el mensaje debe identificar el archivo o carpeta de primer nivel")
    items = [part.strip() for part in subject.split(",")]
    if any(not item for item in items):
        raise ValueError("hay un nombre vacío en la lista separada por comas")
    if any(not NAME_RE.fullmatch(item) for item in items):
        raise ValueError("solo se aceptan nombres de archivo o carpeta válidos")
    if len(set(items)) != len(items):
        raise ValueError("hay elementos repetidos")
    return items


def format_items(items: set[str]) -> str:
    return ", ".join(sorted(items))


def validate_message(message: str, label: str, expected: set[str] | None = None, strip_comments: bool = False) -> list[str]:
    subject, has_body = parse_message(message, strip_comments)
    if subject.startswith(GENERATED_PREFIXES):
        return []
    errors = [f"{label}: el mensaje debe tener una sola línea, sin cuerpo ni trailers"] if has_body else []
    try:
        actual = set(split_items(subject))
    except ValueError as exc:
        return errors + [f"{label}: {exc}"]
    if expected is not None and actual != expected:
        details = []
        if expected - actual:
            details.append("faltan " + format_items(expected - actual))
        if actual - expected:
            details.append("sobran " + format_items(actual - expected))
        errors.append(f"{label}: debe coincidir con los elementos modificados ({format_items(expected)}); " + "; ".join(details))
    return errors


def staged_items() -> set[str]:
    return expected_items(git(["diff", "--cached", "--name-only", f"--diff-filter={DIFF_FILTER}"]).splitlines())


def commit_items(commit: str) -> set[str]:
    paths = git(["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", f"--diff-filter={DIFF_FILTER}", commit]).splitlines()
    return expected_items(paths)


def commit_message(commit: str) -> str:
    return git(["log", "--format=%B", "-n", "1", commit])


def is_merge(commit: str) -> bool:
    return len(git(["show", "-s", "--format=%P", commit]).split()) > 1


def print_errors(errors: list[str]) -> int:
    if not errors:
        print("Mensajes de commit válidos.")
        return 0
    print("Validación de mensajes de commit fallida:\n" + "\n".join(f"- {error}" for error in errors))
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--message-file", type=Path)
    group.add_argument("--range", dest="revision_range")
    group.add_argument("--commit", action="append", default=[])
    parser.add_argument("--staged", action="store_true")
    args = parser.parse_args()
    try:
        if args.message_file:
            expected = staged_items() if args.staged else None
            return print_errors(validate_message(args.message_file.read_text(encoding="utf-8"), str(args.message_file), expected or None, True))
        commits = git(["rev-list", "--reverse", args.revision_range]).splitlines() if args.revision_range else args.commit
        errors = []
        for commit in commits:
            subject, _ = parse_message(commit_message(commit))
            if not is_merge(commit) and not subject.startswith(GENERATED_PREFIXES):
                errors += validate_message(commit_message(commit), f"commit {commit[:12]}", commit_items(commit))
        return print_errors(errors)
    except RuntimeError as exc:
        print(f"ERROR: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
