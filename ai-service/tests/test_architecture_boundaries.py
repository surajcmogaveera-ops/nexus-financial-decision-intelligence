import ast
import asyncio
from pathlib import Path

from fastapi.testclient import TestClient

from app.embeddings.provider import UnavailableEmbeddingProvider
from app.embeddings.types import EmbeddingRequest, EmbeddingStatus
from app.gemini.client import UnimplementedGeminiClient
from app.gemini.types import GenerationRequest, GenerationStatus
from app.prompts.builder import PromptBuilder
from app.rag.pipeline import UnavailableRAGPipeline
from app.rag.types import RAGRequest, RAGStatus
from app.retrieval.retriever import UnavailableRetriever
from app.retrieval.types import RetrievalQuery, RetrievalStatus
from app.schemas.context import AIAnalysisContext
from app.verification.types import VerificationRequest, VerificationStatus
from app.verification.verifier import UnimplementedVerifier
from test_internal_ai import valid_payload_data


AI_SERVICE_ROOT = Path(__file__).resolve().parents[1]


def test_application_and_all_architecture_module_boundaries_import() -> None:
    from app.main import app

    assert app.title == "NEXUS AI Service"
    assert AIAnalysisContext is not None


def test_health_endpoint_remains_available() -> None:
    from app.main import app

    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_pipeline_placeholders_report_unavailable_without_fake_outputs() -> None:
    context = AIAnalysisContext.model_validate(valid_payload_data())

    rag = asyncio.run(UnavailableRAGPipeline().run(RAGRequest(query=context.question, context=context)))
    retrieval = asyncio.run(UnavailableRetriever().retrieve(RetrievalQuery(query="evidence query")))
    embedding = asyncio.run(UnavailableEmbeddingProvider().embed(EmbeddingRequest(text="private text")))
    generation = asyncio.run(UnimplementedGeminiClient().generate(GenerationRequest(prompt="private prompt")))

    assert rag.status is RAGStatus.NOT_IMPLEMENTED and rag.evidence_refs is None
    assert retrieval.status is RetrievalStatus.UNAVAILABLE and retrieval.evidence_refs is None
    assert embedding.status is EmbeddingStatus.UNAVAILABLE and embedding.vector is None
    assert generation.status is GenerationStatus.NOT_IMPLEMENTED and generation.text is None


def test_prompt_builder_serializes_authoritative_context_without_recalculation() -> None:
    context = AIAnalysisContext.model_validate(valid_payload_data())

    prompt = PromptBuilder().build_analysis_prompt(context)

    assert "Do not invent or recalculate financial facts" in prompt.instruction
    assert prompt.context_json == context.model_dump_json()
    assert "10000" in prompt.context_json


def test_verifier_reports_not_implemented_instead_of_verification_success() -> None:
    payload = valid_payload_data()
    context = AIAnalysisContext.model_validate(payload)
    response = {
        "requestId": payload["requestId"],
        "status": "READY",
        "summary": None,
        "keyChanges": [],
        "tradeoffs": [],
        "riskFlags": [],
        "evidenceRefs": [],
        "assumptions": [],
        "limitations": ["AI explanation service is not implemented yet."],
        "model": None,
        "promptVersion": None,
        "calculationVersion": "1.0",
    }
    verification_request = VerificationRequest(response=response, authoritative_context=context)

    result = asyncio.run(UnimplementedVerifier().verify(verification_request))

    assert result.status is VerificationStatus.NOT_IMPLEMENTED
    assert result.verified is None


def test_ai_pipeline_modules_do_not_contain_financial_arithmetic() -> None:
    subsystem_dirs = ("rag", "retrieval", "embeddings", "gemini", "prompts", "verification")
    for subsystem in subsystem_dirs:
        for path in (AI_SERVICE_ROOT / "app" / subsystem).glob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            numeric_ops = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow)
            arithmetic = [
                node for node in ast.walk(tree)
                if isinstance(node, ast.BinOp) and isinstance(node.op, numeric_ops)
                or isinstance(node, ast.AugAssign)
            ]
            assert arithmetic == [], f"Financial arithmetic is not allowed in AI subsystem module {path.name}"
