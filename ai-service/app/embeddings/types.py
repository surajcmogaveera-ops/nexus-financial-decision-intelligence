from pydantic import Field

from app.schemas.ai_analysis import StrictModel
from app.schemas.common import ComponentResult, ComponentStatus


EmbeddingStatus = ComponentStatus


class EmbeddingRequest(StrictModel):
    text: str = Field(min_length=1, max_length=100_000)


class EmbeddingResult(ComponentResult):
    status: EmbeddingStatus
    vector: list[float] | None
