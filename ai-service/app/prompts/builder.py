import json

from app.prompts.templates import ANALYSIS_INSTRUCTION
from app.prompts.types import PromptRequest
from app.schemas.context import AIAnalysisContext


class PromptBuilder:
    def build_analysis_prompt(self, context: AIAnalysisContext) -> PromptRequest:
        """Serialize supplied Node results without deriving new financial values."""
        return PromptRequest(
            instruction=ANALYSIS_INSTRUCTION,
            context_json=context.model_dump_json(),
        )

    def build_generation_prompt(self, prompt: PromptRequest) -> str:
        """Compose the provider prompt; the deterministic context is passed through verbatim."""
        return (
            f"{prompt.instruction}\n\n"
            "AUTHORITATIVE INPUT (Node.js deterministic results, JSON):\n"
            f"{prompt.context_json}\n\n"
            "Return only the requested structured JSON analysis."
        )
