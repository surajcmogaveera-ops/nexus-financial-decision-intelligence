from typing import Protocol

from app.rag.types import RAGRequest, RAGResult, RAGStatus


class RAGPipeline(Protocol):
    async def run(self, request: RAGRequest) -> RAGResult:
        """Orchestrate retrieval and evidence assembly for supplied context."""


class UnavailableRAGPipeline:
    async def run(self, request: RAGRequest) -> RAGResult:
        del request  # No request payload is retained or logged by this placeholder.
        return RAGResult(
            status=RAGStatus.NOT_IMPLEMENTED,
            evidence_refs=None,
            message="RAG orchestration is not implemented.",
        )
