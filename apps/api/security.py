import ipaddress
import os
from dataclasses import dataclass

from fastapi import HTTPException, Request

from packages.adapters.askcos.transport import AskcosTransport, EngineUnavailable


@dataclass(frozen=True)
class Principal:
    owner: str
    administrator: bool = False


def authenticate(request: Request, transport: AskcosTransport) -> Principal:
    mode = os.environ.get("X_SYNTH_AUTH_MODE", "local")
    if mode == "local":
        host = request.client.host if request.client else ""
        try:
            if not ipaddress.ip_address(host).is_loopback:
                raise HTTPException(
                    403, "Local workbench accepts only loopback clients"
                )
        except ValueError as exc:
            raise HTTPException(403, "Invalid local client") from exc
        if request.url.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise HTTPException(403, "Invalid workbench host")
        origin = request.headers.get("origin")
        if origin:
            allowed = os.environ.get(
                "X_SYNTH_ALLOWED_ORIGINS", "http://127.0.0.1:8769,http://localhost:8769"
            ).split(",")
            if origin not in allowed:
                raise HTTPException(403, "Cross-site workbench access is not permitted")
        if request.headers.get("sec-fetch-site") == "cross-site":
            raise HTTPException(403, "Cross-site workbench access is not permitted")
        return Principal("local_workspace", administrator=True)
    if mode != "askcos":
        raise HTTPException(503, "Unsupported identity configuration")
    authorization = request.headers.get("authorization", "")
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Login is required")
    try:
        user = transport.current_user(authorization[7:])
    except EngineUnavailable as exc:
        raise HTTPException(
            503 if exc.recoverable else 401, "Identity verification failed"
        ) from exc
    return Principal(user["username"], user["is_superuser"] is True)
