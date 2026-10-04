"""One product-facing search over independently verified reaction sources."""

from __future__ import annotations

from datetime import UTC, datetime

from packages.adapters.askcos.references import (
    ReferenceAdapter,
    ReferenceError,
    ReferenceQuery,
    ReferenceSearchInput,
    canonical_reference_query,
)

from .reaction_library import ReactionLibrary, ReactionLibraryError
from .reaction_models import (
    EvidenceSourceStatus,
    ReactionEvidence,
    ReactionLibraryResponse,
    ReactionLibraryStatus,
)


def library_source(sources: list[EvidenceSourceStatus]) -> str:
    return sources[0].source if len(sources) == 1 else "OPEN_REACTIONS"


class ReactionEvidenceService:
    def __init__(self, transport, path=None):
        self.native = ReferenceAdapter(transport)
        self.library = ReactionLibrary(path)
        self.has_library = bool(path)

    def status(self) -> ReactionLibraryStatus:
        native = self.native.status()
        sources = [EvidenceSourceStatus.model_validate(native.model_dump())]
        if self.has_library:
            sources.append(self.library.status())
        ready = any(item.ready for item in sources)
        available = [item for item in sources if item.ready]
        # Unknown native counts remain unknown rather than being presented as zero.
        count = (
            sum(item.record_count for item in available)
            if all(item.record_count is not None for item in available)
            else None
        )
        return ReactionLibraryStatus(
            source=library_source(sources),
            sources=sources,
            ready=ready,
            product_index_available=ready,
            record_count=count,
            reason=None if ready else sources[0].reason,
        )

    def search(
        self, body: ReferenceSearchInput, *, max_atoms: int
    ) -> ReactionLibraryResponse:
        query = canonical_reference_query(body, max_atoms=max_atoms)
        requested = ReferenceQuery(
            product=body.product.strip(),
            reactants=[value.strip() for value in body.reactants],
        )
        results, sources, more = [], [], False
        failures = []
        try:
            native = self.native.search(body, max_atoms=max_atoms)
            results.extend(
                ReactionEvidence.model_validate(item.model_dump())
                for item in native.results
            )
            more = native.has_more
            status = self.native.status()
            sources.append(
                EvidenceSourceStatus(
                    source="USPTO_FULL",
                    ready=True,
                    product_index_available=True,
                    record_count=status.record_count if status.ready else None,
                )
            )
        except ReferenceError as exc:
            sources.append(
                EvidenceSourceStatus(
                    source="USPTO_FULL",
                    ready=False,
                    product_index_available=False,
                    reason=exc.code,
                )
            )
            failures.append(exc)
        if self.has_library:
            try:
                local, local_more = self.library.search(query, limit=body.limit)
                results.extend(local)
                more |= local_more
                sources.append(self.library.status())
            except ReactionLibraryError as exc:
                sources.append(
                    EvidenceSourceStatus(
                        source="ORD",
                        ready=False,
                        product_index_available=False,
                        reason=exc.code,
                    )
                )
                failures.append(exc)
        if not any(item.ready for item in sources):
            raise failures[0]
        results.sort(
            key=lambda item: (
                item.match_scope != "reaction_identity",
                not bool(
                    item.conditions and any(item.conditions.model_dump().values())
                ),
                not bool(item.reported_yields),
                item.id,
            )
        )
        if len({item.id for item in results}) != len(results):
            raise ReactionLibraryError("reaction_library_invalid")
        selected = results[: body.limit]
        return ReactionLibraryResponse(
            query=query,
            requested=requested,
            source=library_source(sources),
            sources=sources,
            results=selected,
            count=len(selected),
            has_more=more or len(results) > body.limit,
            retrieved_at=datetime.now(UTC).isoformat(),
        )
