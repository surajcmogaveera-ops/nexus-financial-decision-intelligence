import asyncio
import os
from typing import Protocol

from app.embeddings.types import EmbeddingRequest, EmbeddingResult, EmbeddingStatus


class EmbeddingProvider(Protocol):
    async def embed(self, request: EmbeddingRequest) -> EmbeddingResult:
        """Create an embedding using a configured provider."""


class UnavailableEmbeddingProvider:
    async def embed(self, request: EmbeddingRequest) -> EmbeddingResult:
        del request  # No text is retained or logged by this placeholder.
        return EmbeddingResult(
            status=EmbeddingStatus.NOT_CONFIGURED,
            vector=None,
            message="Embedding provider is unavailable.",
        )


class GeminiEmbeddingProvider:
    """Gemini embedding implementation behind the existing H11 abstraction."""
    async def embed(self, request: EmbeddingRequest) -> EmbeddingResult:
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            return EmbeddingResult(status=EmbeddingStatus.NOT_CONFIGURED, vector=None, message="Embedding provider is not configured.")
        try:
            from google import genai
            from google.genai import types
            def call():
                client = genai.Client(api_key=key)
                return client.models.embed_content(model=os.environ.get("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001"), contents=request.text, config=types.EmbedContentConfig(output_dimensionality=768, task_type="SEMANTIC_SIMILARITY"))
            response = await asyncio.to_thread(call)
            values = response.embeddings[0].values if response.embeddings else None
            if not values or len(values) != 768:
                raise ValueError("Unexpected embedding dimensions")
            return EmbeddingResult(status=EmbeddingStatus.READY, vector=[float(v) for v in values], message="Gemini embedding generated.")
        except Exception:
            return EmbeddingResult(status=EmbeddingStatus.UNAVAILABLE, vector=None, message="Embedding provider is unavailable.")


def create_embedding_provider() -> EmbeddingProvider:
    return GeminiEmbeddingProvider() if os.environ.get("GEMINI_API_KEY") else UnavailableEmbeddingProvider()
