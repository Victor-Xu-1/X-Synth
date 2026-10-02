from fastapi import HTTPException
from starlette.responses import JSONResponse


class RequestLimitMiddleware:
    def __init__(self, app, limit: int):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            return await JSONResponse(
                {"detail": "Invalid content length"}, status_code=400
            )(scope, receive, send)
        if length < 0 or length > self.limit:
            return await JSONResponse(
                {"detail": "Input exceeds the request budget"}, status_code=413
            )(scope, receive, send)
        consumed = 0

        async def bounded_receive():
            nonlocal consumed
            message = await receive()
            consumed += len(message.get("body", b""))
            if consumed > self.limit:
                raise HTTPException(413, "Input exceeds the request budget")
            return message

        await self.app(scope, bounded_receive, send)
