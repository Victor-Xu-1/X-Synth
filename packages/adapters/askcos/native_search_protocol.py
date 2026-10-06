"""Private child channel authentication, independent of product user ownership."""

import os
import secrets

from fastapi.responses import JSONResponse
from packages.platform.native_search_contract import (
    SEARCH_KEY_VARIABLE, NATIVE_SEARCH_HEADER, NATIVE_SEARCH_PREFIX,
    NATIVE_SEARCH_READY_PATH, NATIVE_SEARCH_PROTOCOL, NATIVE_SEARCH_PROTOCOL_VERSION,
)

__all__ = [
    "SEARCH_KEY_VARIABLE", "NATIVE_SEARCH_HEADER", "NATIVE_SEARCH_PREFIX",
    "NATIVE_SEARCH_READY_PATH", "NATIVE_SEARCH_PROTOCOL", "NATIVE_SEARCH_PROTOCOL_VERSION",
    "NativeSearchAuthentication", "managed_search_profile",
]


def managed_search_profile():
    return (
        os.environ.get("MODULE_CONFIG_PATH") == "configs.module_config_x_synth"
        or SEARCH_KEY_VARIABLE in os.environ
    )


class NativeSearchAuthentication:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if scope["type"] == "http" and (path == NATIVE_SEARCH_PREFIX or path.startswith(NATIVE_SEARCH_PREFIX + "/")):
            expected = os.environ.get(SEARCH_KEY_VARIABLE, "")
            key = dict(scope["headers"]).get(NATIVE_SEARCH_HEADER.lower().encode())
            if not expected:
                return await JSONResponse({"detail": "Private native search is not configured"}, status_code=503)(scope, receive, send)
            if key is None or not secrets.compare_digest(key, expected.encode()):
                return await JSONResponse({"detail": "Private native search authentication failed"}, status_code=403)(scope, receive, send)
        await self.app(scope, receive, send)
