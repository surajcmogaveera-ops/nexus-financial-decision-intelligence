import hmac
import os
from typing import Annotated

from fastapi import Header, HTTPException


def require_service_token(
    service_token: Annotated[str | None, Header(alias="X-Service-Token")] = None,
) -> None:
    expected = os.environ.get("SERVICE_TOKEN")
    if not expected:
        raise HTTPException(
            status_code=503,
            detail={"code": "SERVICE_AUTH_UNAVAILABLE", "message": "Service authentication is not configured."},
        )

    supplied_bytes = (service_token or "").encode("utf-8")
    expected_bytes = expected.encode("utf-8")
    if not service_token or not hmac.compare_digest(supplied_bytes, expected_bytes):
        raise HTTPException(
            status_code=401,
            detail={"code": "UNAUTHORIZED", "message": "A valid service token is required."},
        )
