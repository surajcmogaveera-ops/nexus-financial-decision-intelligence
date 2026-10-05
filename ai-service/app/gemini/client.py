from typing import Protocol

from app.gemini.types import GenerationRequest, GenerationResult, GenerationStatus


class GeminiClient(Protocol):
    async def generate(self, request: GenerationRequest) -> GenerationResult:
        """Generate model output when an approved provider is configured."""


class UnimplementedGeminiClient:
    async def generate(self, request: GenerationRequest) -> GenerationResult:
        del request  # No prompt content is retained or logged by this placeholder.
        return GenerationResult(
            status=GenerationStatus.NOT_IMPLEMENTED,
            text=None,
            message="Gemini generation is not implemented.",
        )
