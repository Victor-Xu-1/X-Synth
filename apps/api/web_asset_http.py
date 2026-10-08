import re
from dataclasses import dataclass
from urllib.parse import unquote_to_bytes

from starlette.datastructures import Headers
from starlette.exceptions import HTTPException


class RejectedAssetPath(HTTPException):
    def __init__(self):
        super().__init__(404, "Not Found", headers=error_headers())


def error_headers() -> dict[str, str]:
    return {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Vary": "Accept-Encoding",
    }


def validate_asset_path(path: str, raw_path: bytes | None = None) -> None:
    # Check before StaticFiles normalizes dot segments or the SPA fallback runs.
    if (
        len(path) > 4096
        or path.startswith("//")
        or any(ord(c) < 32 or ord(c) == 127 or 0xD800 <= ord(c) <= 0xDFFF for c in path)
        or any(c in path for c in ("\\", ":", "%"))
        or any(part in {".", ".."} for part in path.split("/"))
        or path.strip("/").split("/", 1)[0].lower() == "api"
    ):
        raise RejectedAssetPath()
    if raw_path is not None and (
        len(raw_path) > 12288 or re.search(rb"%(?![0-9a-fA-F]{2})", raw_path)
    ):
        raise RejectedAssetPath()
    if raw_path is not None:
        try:
            unquote_to_bytes(raw_path).decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            raise RejectedAssetPath() from exc


@dataclass(frozen=True)
class EncodingPreferences:
    gzip: int
    identity: int

    @property
    def prefers_gzip(self) -> bool:
        return self.gzip > 0 and self.gzip >= self.identity


def encoding_preferences(headers: Headers) -> EncodingPreferences:
    values = headers.getlist("accept-encoding")
    if not values:
        return EncodingPreferences(gzip=0, identity=1000)
    if sum(len(value) for value in values) > 4096:
        raise HTTPException(400, "Accept-Encoding is too large")
    tokens = ",".join(values).split(",")
    if len(tokens) > 64:
        raise HTTPException(400, "Too many content codings")
    qualities = {}
    for token in tokens:
        parts = [part.strip() for part in token.split(";")]
        coding = parts[0].lower()
        if not coding:
            continue
        quality = 1000
        if len(parts) > 1:
            parameter = re.fullmatch(
                r"q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)", parts[1], re.I
            )
            quality = 0
            if parameter and len(parts) == 2:
                integer, _, fraction = parameter[1].partition(".")
                quality = 1000 if integer == "1" else int(fraction.ljust(3, "0"))
        # Conflicting duplicate entries cannot undo an explicit refusal.
        qualities[coding] = min(quality, qualities.get(coding, quality))
    wildcard = qualities.get("*", 0)
    identity = qualities.get("identity", 0 if qualities.get("*") == 0 else 1000)
    return EncodingPreferences(gzip=qualities.get("gzip", wildcard), identity=identity)
