"""Gemini provider environment configuration.

Configuration is read from the environment at request time. The API key is
never logged, never exposed in ``repr``, and never hardcoded.
"""

import os
from dataclasses import dataclass, field

DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_TIMEOUT_MS = 20_000


@dataclass(frozen=True)
class GeminiConfig:
    api_key: str = field(repr=False)
    model: str
    timeout_ms: int


def load_gemini_config() -> GeminiConfig | None:
    """Return configuration when a usable key/model is set, otherwise ``None``."""
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None
    model = os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip()
    if not model:
        return None
    return GeminiConfig(api_key=api_key, model=model, timeout_ms=_load_timeout_ms())


def _load_timeout_ms() -> int:
    raw = os.environ.get("GEMINI_TIMEOUT_MS", "").strip()
    if not raw:
        return DEFAULT_TIMEOUT_MS
    try:
        parsed = int(raw)
    except ValueError:
        return DEFAULT_TIMEOUT_MS
    if parsed <= 0:
        return DEFAULT_TIMEOUT_MS
    return parsed
