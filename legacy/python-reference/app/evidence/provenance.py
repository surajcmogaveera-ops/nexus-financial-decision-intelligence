from enum import Enum


class ProvenanceType(str, Enum):
    USER = "USER"
    COMPUTED = "COMPUTED"
    EXTERNAL = "EXTERNAL"
    RETRIEVED = "RETRIEVED"
    AI_INTERPRETATION = "AI_INTERPRETATION"

