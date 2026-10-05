from typing import Protocol

from app.verification.types import VerificationRequest, VerificationResult, VerificationStatus


class Verifier(Protocol):
    async def verify(self, request: VerificationRequest) -> VerificationResult:
        """Check generated claims against supplied authoritative context."""


class UnimplementedVerifier:
    async def verify(self, request: VerificationRequest) -> VerificationResult:
        del request  # No analysis payload is retained or logged by this placeholder.
        return VerificationResult(
            status=VerificationStatus.NOT_IMPLEMENTED,
            verified=None,
            message="AI output verification is not implemented.",
        )
