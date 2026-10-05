from enum import Enum

from app.schemas.ai_analysis import StrictModel


class ComponentStatus(str, Enum):
    NOT_IMPLEMENTED = "NOT_IMPLEMENTED"
    UNAVAILABLE = "UNAVAILABLE"
    READY = "READY"
    NOT_CONFIGURED = "NOT_CONFIGURED"
    INVALID_OUTPUT = "INVALID_OUTPUT"
    ERROR = "ERROR"


class ComponentResult(StrictModel):
    status: ComponentStatus
    message: str
