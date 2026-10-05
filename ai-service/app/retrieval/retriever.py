from typing import Protocol

from app.retrieval.types import RetrievalQuery, RetrievalResult, RetrievalStatus


class Retriever(Protocol):
    async def retrieve(self, request: RetrievalQuery) -> RetrievalResult:
        """Return references to retrieved evidence when a provider is configured."""


class UnavailableRetriever:
    async def retrieve(self, request: RetrievalQuery) -> RetrievalResult:
        del request  # The unavailable provider does not retain or log queries.
        return RetrievalResult(
            status=RetrievalStatus.UNAVAILABLE,
            evidence_refs=None,
            message="Evidence retrieval is unavailable.",
        )
