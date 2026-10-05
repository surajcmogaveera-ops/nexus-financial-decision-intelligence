"""Real Gemini provider behind the existing ``GeminiClient`` protocol.

Callers depend only on the protocol and the typed ``GenerationResult``; the
Google GenAI SDK never leaks past this module. The provider requests
schema-constrained JSON output (``response_schema`` + ``application/json``)
so Gemini must return structure matching the strict Pydantic model. Raw
provider text is validated separately by the analysis pipeline.

Failure states are explicit and never fabricated into success:
``NOT_CONFIGURED`` (no usable key/model), ``UNAVAILABLE`` (API failure or
timeout), ``INVALID_OUTPUT`` (no structured content), ``ERROR`` (provider or
SDK exception). The API key is read from the environment and never logged.
"""

import asyncio

from app.core.gemini_config import GeminiConfig, load_gemini_config
from app.gemini.client import GeminiClient
from app.gemini.types import GenerationRequest, GenerationResult, GenerationStatus
from app.schemas.gemini_analysis import GeminiStructuredAnalysis

try:  # pragma: no cover - exercised only when the declared dependency is present
    from google import genai
    from google.genai import errors as genai_errors
    from google.genai import types as genai_types
except Exception:  # pragma: no cover - handled as an explicit provider failure
    genai = None
    genai_errors = None
    genai_types = None

_GENERATION_SUCCEEDED = "Gemini returned structured output."


class GoogleGeminiClient:
    """Generates schema-constrained JSON with the official Google GenAI SDK."""

    def __init__(self, config: GeminiConfig) -> None:
        self._config = config

    async def generate(self, request: GenerationRequest) -> GenerationResult:
        try:
            return await asyncio.to_thread(self._generate_sync, request)
        except Exception:
            # Never surface raw provider exceptions or the API key.
            return GenerationResult(
                status=GenerationStatus.ERROR,
                text=None,
                message="Gemini generation failed unexpectedly.",
                model=self._config.model,
            )

    def _generate_sync(self, request: GenerationRequest) -> GenerationResult:
        if genai is None:
            return GenerationResult(
                status=GenerationStatus.ERROR,
                text=None,
                message="The Google GenAI SDK is not installed.",
                model=self._config.model,
            )
        try:
            client = genai.Client(
                api_key=self._config.api_key,
                http_options=genai_types.HttpOptions(timeout=self._config.timeout_ms),
            )
            response = client.models.generate_content(
                model=self._config.model,
                contents=request.prompt,
                config=genai_types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=GeminiStructuredAnalysis,
                ),
            )
        except Exception as exc:
            return self._failure_result(exc)

        try:
            text = response.text
        except Exception:
            text = None
        if not text or not text.strip():
            return GenerationResult(
                status=GenerationStatus.INVALID_OUTPUT,
                text=None,
                message="Gemini returned no structured content.",
                model=self._config.model,
            )
        return GenerationResult(
            status=GenerationStatus.READY,
            text=text,
            message=_GENERATION_SUCCEEDED,
            model=self._config.model,
        )

    def _failure_result(self, exc: Exception) -> GenerationResult:
        detail = type(exc).__name__
        if _is_timeout(exc):
            return GenerationResult(
                status=GenerationStatus.UNAVAILABLE,
                text=None,
                message="The Gemini request timed out.",
                model=self._config.model,
            )
        if genai_errors is not None and isinstance(exc, genai_errors.ServerError):
            return GenerationResult(
                status=GenerationStatus.UNAVAILABLE,
                text=None,
                message=f"The Gemini API failed ({detail}).",
                model=self._config.model,
            )
        if genai_errors is not None and isinstance(exc, genai_errors.ClientError):
            return GenerationResult(
                status=GenerationStatus.ERROR,
                text=None,
                message=f"Gemini rejected the request ({detail}).",
                model=self._config.model,
            )
        return GenerationResult(
            status=GenerationStatus.ERROR,
            text=None,
            message=f"Gemini provider error ({detail}).",
            model=self._config.model,
        )


class UnconfiguredGeminiClient:
    """Returned when no usable Gemini credentials are configured."""

    async def generate(self, request: GenerationRequest) -> GenerationResult:
        del request  # No prompt content is retained or logged.
        return GenerationResult(
            status=GenerationStatus.NOT_CONFIGURED,
            text=None,
            message="Gemini is not configured. Set GEMINI_API_KEY to enable generation.",
        )


def create_gemini_client() -> GeminiClient:
    """Build the provider from the environment; unconfigured environments stay inert."""
    config = load_gemini_config()
    if config is None:
        return UnconfiguredGeminiClient()
    return GoogleGeminiClient(config)


def _is_timeout(exc: BaseException) -> bool:
    if isinstance(exc, TimeoutError):
        return True
    return "Timeout" in type(exc).__name__
