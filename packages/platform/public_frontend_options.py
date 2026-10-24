"""Pure projection of native configuration rows onto the product's public options."""

import json


_PUBLIC_KEYS = frozenset({"VITE_EMAIL_REQUIRED"})


class PublicFrontendOptionsError(ValueError):
    """The upstream payload cannot be safely projected."""


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise PublicFrontendOptionsError
        result[key] = value
    return result


def _reject_constant(_value):
    raise PublicFrontendOptionsError


def project_public_frontend_options(payload: bytes) -> bytes:
    try:
        rows = json.loads(
            payload.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (ValueError, RecursionError):
        raise PublicFrontendOptionsError from None
    if not isinstance(rows, list):
        raise PublicFrontendOptionsError

    projected = []
    seen = set()
    for row in rows:
        if (
            not isinstance(row, dict)
            or set(row) != {"key", "value"}
            or not isinstance(row["key"], str)
            or not isinstance(row["value"], str)
        ):
            raise PublicFrontendOptionsError
        try:
            row["key"].encode("utf-8")
            row["value"].encode("utf-8")
        except UnicodeError:
            raise PublicFrontendOptionsError from None
        if row["key"] in _PUBLIC_KEYS:
            if row["key"] in seen:
                raise PublicFrontendOptionsError
            seen.add(row["key"])
            projected.append(row)
    return json.dumps(
        projected, ensure_ascii=True, allow_nan=False, separators=(",", ":")
    ).encode("utf-8")
