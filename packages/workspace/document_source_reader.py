"""Single admitted, cancellable source read, independent of route inference."""

from time import monotonic

from packages.adapters.askcos.transport import EngineUnavailable
from packages.orchestrator.review_execution import CancellableReview
from packages.platform.performance import DocumentSourceLimits

from .document_source import resolve_document_source, unavailable


class DocumentSourceReader:
    def __init__(self, *, documents, repository, artifacts, budget, limits=None):
        self.documents, self.repository = documents, repository
        self.artifacts, self.budget = artifacts, budget
        self.limits = limits or DocumentSourceLimits()
        self.executor = CancellableReview()

    def read(self, identifier, owner, *, cancelled):
        deadline = monotonic() + self.limits.read_seconds
        context = self.documents.source_context(identifier, owner)
        document, source = context["document"], context["provenance"]
        if document["state"] != "source_copy":
            return unavailable(document, "not_source_copy")
        job_id = source.get("job_id")
        if not isinstance(job_id, str):
            return unavailable(document, "source_job_unavailable")
        job = self.repository.get(job_id, owner=owner)
        if job is None:
            return unavailable(document, "source_job_unavailable")
        try:
            result = self.executor.run(
                resolve_document_source, context, job, str(self.artifacts),
                self.budget.max_structure_atoms, self.budget.response_bytes,
                interrupted=lambda: cancelled() or monotonic() >= deadline,
            )
            latest = self.documents.get(identifier, owner)
            if latest["revision"] != document["revision"]:
                return unavailable(latest, "source_document_changed")
            if self.repository.get(job_id, owner=owner) is None:
                return unavailable(latest, "source_job_unavailable")
            if cancelled() or monotonic() >= deadline:
                raise EngineUnavailable("review_interrupted", recoverable=True)
            return result
        except EngineUnavailable as exc:
            if exc.code == "review_busy":
                code = "document_source_busy"
            elif monotonic() >= deadline:
                code = "document_source_timeout"
            else:
                code = "document_source_unavailable"
            raise EngineUnavailable(code, recoverable=True) from exc

    def close(self):
        self.executor.close()
