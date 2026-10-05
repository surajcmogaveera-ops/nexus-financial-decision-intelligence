from typing import Protocol

from app.embeddings.types import EmbeddingRequest, EmbeddingResult, EmbeddingStatus


class EmbeddingProvider(Protocol):
    async def embed(self, request: EmbeddingRequest) -> EmbeddingResult:
        """Create an embedding using a configured provider."""


class UnavailableEmbeddingProvider:
    async def embed(self, request: EmbeddingRequest) -> EmbeddingResult:
        del request  # No text is retained or logged by this placeholder.
        return EmbeddingResult(
            status=EmbeddingStatus.UNAVAILABLE,
            vector=None,
            message="Embedding provider is unavailable.",
        )
