#!/usr/bin/env python3
"""Valida el formato de los mensajes de commit del repositorio.

Convención: el mensaje es exactamente el nombre base del archivo modificado.
Si el commit toca varios archivos, los nombres van separados por coma y en
orden alfabético. Ejemplos: «README.md» o «app.js, style.css».
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")
GENERATED_PREFIXES = ("Merge ", "Revert ", "fixup! ", "squash! ")
DIFF_FILTER = "ACDMRT"


class ValidationError(Exception):
    """Error legible para el usuario."""


def git(args: list[str]) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        detail = (result.stdout + result.stderr).strip()
        raise RuntimeError(detail or f"git {' '.join(args)} falló")
    return result.stdout


def cleaned_lines(message: str, *, strip_comments: bool) -> list[str]:
    lines = message.splitlines()
    if strip_comments:
        lines = [line for line in lines if not line.lstrip().startswith("#")]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return lines


def parse_message(message: str, *, strip_comments: bool) -> tuple[str, bool]:
    lines = cleaned_lines(message, strip_comments=strip_comments)
    if not lines:
        return "", False
    subject = lines[0].strip()
    has_body = any(line.strip() for line in lines[1:])
    return subject, has_body


def split_names(subject: str) -> list[str]:
    """Extrae y valida los nombres de archivo del asunto canónico."""
    if not subject:
        raise ValidationError(
            "el mensaje debe ser exactamente el nombre del archivo modificado "
            "(varios se separan por coma, ej.: «app.js, style.css»)"
        )

    names = [part.strip() for part in subject.split(",")]
    if any(not name for name in names):
        raise ValidationError("hay un nombre vacío en la lista separada por comas")

    invalid = [name for name in names if not NAME_RE.fullmatch(name)]
    if invalid:
        raise ValidationError(
            "solo se aceptan nombres base de archivo con letras, números, punto, guion o guion bajo: "
            + ", ".join(invalid)
        )

    repeated = sorted({name for name in names if names.count(name) > 1})
    if repeated:
        raise ValidationError("hay nombres repetidos: " + ", ".join(repeated))

    return names


def basenames(paths: list[str]) -> set[str]:
    return {Path(path).name for path in paths if Path(path).name}


def format_names(names: set[str]) -> str:
    return ", ".join(sorted(names))


def format_subject(names: set[str]) -> str:
    """Construye el asunto canónico usado por el hook de preparación."""
    return format_names(names)


def validate_message(
    message: str,
    *,
    label: str,
    expected_names: set[str] | None = None,
    strip_comments: bool = False,
) -> list[str]:
    subject, has_body = parse_message(message, strip_comments=strip_comments)
    if subject.startswith(GENERATED_PREFIXES):
        return []

    errors: list[str] = []
    if has_body:
        errors.append(f"{label}: el mensaje debe tener una sola línea, sin cuerpo ni trailers")

    try:
        names = split_names(subject)
    except ValidationError as exc:
        errors.append(f"{label}: {exc}")
        return errors

    if expected_names is not None:
        actual = set(names)
        missing = expected_names - actual
        extra = actual - expected_names
        if missing or extra:
            details: list[str] = []
            if missing:
                details.append("faltan " + format_names(missing))
            if extra:
                details.append("sobran " + format_names(extra))
            errors.append(
                f"{label}: el mensaje debe coincidir con los archivos del commit "
                f"({format_names(expected_names)}); " + "; ".join(details)
            )

    return errors


def staged_basenames() -> set[str]:
    paths = git(["diff", "--cached", "--name-only", f"--diff-filter={DIFF_FILTER}"]).splitlines()
    return basenames(paths)


def commit_basenames(commit: str) -> set[str]:
    paths = git(
        [
            "diff-tree",
            "--root",
            "--no-commit-id",
            "--name-only",
            "-r",
            f"--diff-filter={DIFF_FILTER}",
            commit,
        ]
    ).splitlines()
    return basenames(paths)


def commit_message(commit: str) -> str:
    return git(["log", "--format=%B", "-n", "1", commit])


def commit_is_merge(commit: str) -> bool:
    parents = git(["show", "-s", "--format=%P", commit]).split()
    return len(parents) > 1


def commits_in_range(revision_range: str) -> list[str]:
    return git(["rev-list", "--reverse", revision_range]).splitlines()


def validate_message_file(path: Path, *, use_staged_files: bool) -> int:
    expected = staged_basenames() if use_staged_files else None
    # Durante un amend puede no haber cambios en staging. En ese caso se
    # valida el formato, pero no se puede inferir la lista desde el índice.
    if use_staged_files and not expected:
        expected = None
    errors = validate_message(
        path.read_text(encoding="utf-8"),
        label=str(path),
        expected_names=expected,
        strip_comments=True,
    )
    return print_errors(errors)


def validate_commits(commits: list[str]) -> int:
    errors: list[str] = []
    for commit in commits:
        subject, _ = parse_message(commit_message(commit), strip_comments=False)
        short = commit[:12]
        if commit_is_merge(commit) or subject.startswith(GENERATED_PREFIXES):
            continue
        errors.extend(
            validate_message(
                commit_message(commit),
                label=f"commit {short}",
                expected_names=commit_basenames(commit),
                strip_comments=False,
            )
        )
    return print_errors(errors)


def print_errors(errors: list[str]) -> int:
    if not errors:
        print("Mensajes de commit válidos.")
        return 0
    print("Validación de mensajes de commit fallida:")
    print("\n".join(f"- {error}" for error in errors))
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Valida que cada mensaje sea exactamente el nombre base del/los "
            "archivo(s) del commit."
        ),
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--message-file", type=Path, help="archivo de mensaje recibido por el hook commit-msg")
    group.add_argument("--range", dest="revision_range", help="rango git, por ejemplo base..head")
    group.add_argument("--commit", action="append", default=[], help="commit puntual a validar; se puede repetir")
    parser.add_argument("--staged", action="store_true", help="comparar --message-file contra los archivos en staging")
    args = parser.parse_args()

    try:
        if args.message_file:
            return validate_message_file(args.message_file, use_staged_files=args.staged)
        if args.revision_range:
            return validate_commits(commits_in_range(args.revision_range))
        return validate_commits(args.commit)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
