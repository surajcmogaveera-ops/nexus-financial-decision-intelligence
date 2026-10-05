from app.schemas.ai_analysis import StrictModel


class PromptRequest(StrictModel):
    instruction: str
    context_json: str
