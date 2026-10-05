"""Session hermeticity: the normal suite must never use ambient Gemini credentials.

Strips Gemini configuration so tests cannot reach the network through a
developer's shell or a local ``.env``. The opt-in live test
(``NEXUS_LIVE_GEMINI_TEST=true``) keeps its credentials.
"""

import os

import pytest


@pytest.fixture(autouse=True)
def _hermetic_gemini_env(monkeypatch: pytest.MonkeyPatch) -> None:
    if os.environ.get("NEXUS_LIVE_GEMINI_TEST", "").lower() == "true":
        return
    for variable in ("GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_TIMEOUT_MS"):
        monkeypatch.delenv(variable, raising=False)
