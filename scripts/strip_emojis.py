#!/usr/bin/env python3
"""Quita emojis de un texto para los mensajes de Discord.

Los mensajes del canal de Actualizaciones deben ser texto organizado, sin
emojis; los títulos agregan su emoji aparte (📝 changelog, 💚 release). Esta
utilidad recibe el texto por stdin y lo imprime sin emojis por stdout:

    printf 'hola ☁️ mundo' | python3 scripts/strip_emojis.py
    # → hola mundo

También se importa desde `changelog_discord.py` para limpiar la descripción
del embed sin tocar el título.
"""
from __future__ import annotations

import re
import sys

# Bloques Unicode de emojis. Se dejan afuera a propósito los caracteres de
# texto con apariencia parecida que sí se usan en el changelog (— · →).
EMOJI_RE = re.compile(
    "["
    "\U0001F000-\U0001FAFF"  # pictogramas, emoticones, transporte, símbolos, banderas…
    "\U00002600-\U000027BF"  # símbolos varios y dingbats (☀ ☁ ✅ ❌…)
    "\U00002B00-\U00002BFF"  # símbolos y flechas varios (⬇ ⬆ ⬅ ➡…)
    "\U00002300-\U000023FF"  # símbolos técnicos varios (⌚ ⌛ ⏰…)
    "\uFE0E-\uFE0F"          # selectores de variación
    "\u200D"                 # zero width joiner
    "\u20E3"                 # tecla de emoji (1️⃣ 2️⃣…)
    "]+",
)


def strip_emojis(text: str) -> str:
    """Devuelve el texto sin emojis, colapsando los espacios que quedan."""
    return re.sub(r" {2,}", " ", EMOJI_RE.sub("", text))


if __name__ == "__main__":
    sys.stdout.write(strip_emojis(sys.stdin.read()))
