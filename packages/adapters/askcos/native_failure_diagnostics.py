"""Operation attribution without exposing requests, URLs or exception messages."""

import hashlib
import json
import logging
import re
from contextlib import contextmanager

from pydantic import BaseModel

from packages.platform.native_endpoints import ENDPOINTS


OPERATIONS = frozenset({
    "cache_lookup", "cache_decode", "cache_write",
    "retro_cache_lookup", "retro_cache_decode", "retro_backend_call",
    "retro_response_conversion", "retro_cache_write",
    "value_network_call", "value_network_decode", "expand_one_call",
})
MAX_CAUSES = 8
LOGGER = logging.getLogger(__name__)
ERROR_OPERATIONS = {"ExpandOneBackendError": "expand_one_call"}


def native_failure_context(exc):
    """Recover only allowlisted context through a bounded explicit cause chain."""
    original = exc
    result, seen = {}, set()
    for _ in range(MAX_CAUSES):
        if not isinstance(exc, BaseException) or id(exc) in seen:
            break
        seen.add(id(exc))
        context = getattr(exc, "native_operation_context", None)
        if "operation" not in result and isinstance(context, dict):
            operation = context.get("operation")
            if isinstance(operation, str) and operation in OPERATIONS:
                result["operation"] = operation
                digest = context.get("input_sha256")
                if isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest):
                    result["input_sha256"] = digest
        service = getattr(exc, "service", None)
        if "service" not in result and isinstance(service, str) and service in ENDPOINTS:
            result["service"] = service
        exc = exc.__cause__
    if "operation" not in result:
        operation = ERROR_OPERATIONS.get(type(original).__name__)
        if operation is not None:
            result["operation"] = operation
    return result


def _operation_context(operation, request):
    if not isinstance(operation, str) or operation not in OPERATIONS:
        raise ValueError("Unknown native diagnostic operation")
    result = {"operation": operation}
    if request is not None:
        try:
            payload = request.model_dump(mode="json") if isinstance(request, BaseModel) else request
            encoded = json.dumps(payload, sort_keys=True, allow_nan=False, separators=(",", ":")).encode()
        except (TypeError, ValueError):
            # A diagnostic fingerprint must not replace the operation's original error.
            return result
        result["input_sha256"] = hashlib.sha256(encoded).hexdigest()
    return result


@contextmanager
def native_operation(operation, *, request=None, ignore=()):
    """Attribute and rethrow the same failure; cache misses remain normal control flow."""
    context = _operation_context(operation, request)
    try:
        yield
    except Exception as exc:
        if isinstance(exc, ignore):
            raise
        if "operation" not in native_failure_context(exc):
            exc.native_operation_context = context
            from .native_http import native_failure_details

            details = {**native_failure_details(exc), **native_failure_context(exc)}
            LOGGER.error("Native operation failed: %s", json.dumps(details, sort_keys=True))
        raise
