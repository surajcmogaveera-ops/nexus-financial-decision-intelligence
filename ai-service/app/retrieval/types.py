from pydantic import Field

from app.schemas.ai_analysis import StrictModel
from app.schemas.common import ComponentResult, ComponentStatus


RetrievalStatus = ComponentStatus


class RetrievalQuery(StrictModel):
    query: str = Field(min_length=1, max_length=2000)


class RetrievalResult(ComponentResult):
    status: RetrievalStatus
    evidence_refs: list[str] | None
