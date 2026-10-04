"""USPTO provider transport and cache, with stable public reference exports."""

from __future__ import annotations

import json
from threading import Lock
from time import monotonic
from urllib.error import HTTPError

from pydantic import ValidationError

from .reference_identity import (
    _verify_native_record,
    canonical_reference_query,
    canonical_structure,
    component_multiset,
    parse_reference_reaction,
    product_recall_key,
    reaction_match_scope,
    reference_from_document,
    reference_search_response,
)
from .reference_models import (
    MAX_CANDIDATES,
    MAX_REACTION_LENGTH,
    MAX_REFERENCE_ATOMS,
    MAX_RESULTS,
    MAX_SMILES_LENGTH,
    SEARCH_PATH,
    SOURCE,
    STATUS_CACHE_SECONDS,
    STATUS_PATH,
    ReactionReference,
    Reason,
    ReferenceError,
    ReferenceModel,
    ReferenceProvenance,
    ReferenceQuery,
    ReferenceSearchInput,
    ReferenceSearchResponse,
    ReferenceStatus,
    ReportedYield,
    Smiles,
    YieldMethod,
)
from .transport import AskcosTransport, EngineUnavailable

__all__ = [
    "MAX_CANDIDATES",
    "MAX_REACTION_LENGTH",
    "MAX_REFERENCE_ATOMS",
    "MAX_RESULTS",
    "MAX_SMILES_LENGTH",
    "SEARCH_PATH",
    "SOURCE",
    "STATUS_CACHE_SECONDS",
    "STATUS_PATH",
    "AskcosTransport",
    "EngineUnavailable",
    "ReactionReference",
    "Reason",
    "ReferenceAdapter",
    "ReferenceError",
    "ReferenceModel",
    "ReferenceProvenance",
    "ReferenceQuery",
    "ReferenceSearchInput",
    "ReferenceSearchResponse",
    "ReferenceStatus",
    "ReportedYield",
    "Smiles",
    "YieldMethod",
    "canonical_reference_query",
    "canonical_structure",
    "component_multiset",
    "parse_reference_reaction",
    "product_recall_key",
    "reaction_match_scope",
    "reference_from_document",
    "reference_search_response",
]


def _native_error_body(exc: EngineUnavailable) -> dict:
    cause = exc.__cause__
    if not isinstance(cause, HTTPError):
        return {}
    try:
        raw = cause.read(4097)
        data = json.loads(raw) if len(raw) <= 4096 else None
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}
    finally:
        cause.close()


def _native_failure_reason(exc: EngineUnavailable) -> Reason:
    return (
        "reference_endpoint_unavailable"
        if exc.code == "native_http_404"
        else "reference_native_unavailable"
    )


class ReferenceAdapter:
    def __init__(self, transport: AskcosTransport):
        self.transport = transport
        self._lock = Lock()
        self._status: ReferenceStatus | None = None
        self._checked_at = 0.0

    def status(self) -> ReferenceStatus:
        with self._lock:
            if (
                self._status is not None
                and monotonic() - self._checked_at < STATUS_CACHE_SECONDS
            ):
                return self._status.model_copy(deep=True)
            try:
                payload = self.transport.call(STATUS_PATH, method="GET", timeout=4)
                snapshot = ReferenceStatus.model_validate(payload)
            except EngineUnavailable as exc:
                payload = _native_error_body(exc)
                try:
                    snapshot = ReferenceStatus.model_validate(payload)
                    if snapshot.ready:
                        snapshot = ReferenceStatus(
                            ready=False,
                            product_index_available=False,
                            reason="reference_native_protocol_error",
                        )
                except ValidationError:
                    snapshot = ReferenceStatus(
                        ready=False,
                        product_index_available=False,
                        reason=_native_failure_reason(exc),
                    )
            except ValidationError:
                snapshot = ReferenceStatus(
                    ready=False,
                    product_index_available=False,
                    reason="reference_native_protocol_error",
                )
            self._status, self._checked_at = snapshot, monotonic()
            return snapshot.model_copy(deep=True)

    def search(
        self, body: ReferenceSearchInput, *, max_atoms: int = MAX_REFERENCE_ATOMS
    ) -> ReferenceSearchResponse:
        requested = ReferenceQuery(
            product=body.product.strip(),
            reactants=[smiles.strip() for smiles in body.reactants],
        )
        limit = body.limit
        query = canonical_reference_query(body, max_atoms=max_atoms)
        try:
            payload = self.transport.call(
                SEARCH_PATH,
                body={**query.model_dump(), "limit": limit},
                method="POST",
                timeout=4,
            )
        except EngineUnavailable as exc:
            detail = _native_error_body(exc).get("detail")
            try:
                reason = ReferenceStatus.model_validate(
                    {
                        "ready": False,
                        "product_index_available": False,
                        "reason": detail.get("code")
                        if isinstance(detail, dict)
                        else None,
                    }
                ).reason
            except ValidationError:
                reason = _native_failure_reason(exc)
            raise ReferenceError(reason) from exc
        try:
            response = ReferenceSearchResponse.model_validate(payload)
            if (
                response.query != query
                or response.count > limit
                or response.has_more
                and response.count != limit
            ):
                raise ValueError("Reference response belongs to a different query")
            for record in response.results:
                _verify_native_record(record, query)
            # Only this product request owns the raw-input echo; native metadata does not.
            return response.model_copy(update={"requested": requested})
        except (ValueError, RuntimeError, TypeError, KeyError) as exc:
            raise ReferenceError("reference_native_protocol_error", status=502) from exc
