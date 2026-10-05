from enum import Enum

from app.schemas.ai_analysis import StrictModel


class ComponentStatus(str, Enum):
    NOT_IMPLEMENTED = "NOT_IMPLEMENTED"
    UNAVAILABLE = "UNAVAILABLE"


class ComponentResult(StrictModel):
    status: ComponentStatus
    message: str
