"""JSON-safe validation errors, scoped to workspace HTTP routes."""

import math

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute


def _finite_json(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: _finite_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_finite_json(item) for item in value]
    return value


class WorkspaceRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def validated(request: Request):
            try:
                return await handler(request)
            except RequestValidationError as exc:
                detail = _finite_json(jsonable_encoder(exc.errors()))
                return JSONResponse({"detail": detail}, status_code=422)

        return validated
