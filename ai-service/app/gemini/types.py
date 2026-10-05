from pydantic import Field

from app.schemas.ai_analysis import StrictModel
from app.schemas.common import ComponentResult, ComponentStatus


GenerationStatus = ComponentStatus


class GenerationRequest(StrictModel):
    prompt: str = Field(min_length=1, max_length=100_000)


class GenerationResult(ComponentResult):
    status: GenerationStatus
    text: str | None
