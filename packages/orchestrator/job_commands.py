"""One application authority for admission, replay and user lifecycle commands."""

from .job_repository import JobConflict


class RouteDependenciesUnavailable(RuntimeError):
    pass


class RouteJobCommands:
    def __init__(self, *, repository, readiness, budget):
        self.repository, self.readiness, self.budget = repository, readiness, budget

    def owned(self, identifier, owner):
        job = self.repository.get(identifier, owner=owner)
        if job is None:
            raise KeyError("Task does not exist")
        return job

    def submit(self, owner, request, *, request_key=None):
        if request_key is not None and not 1 <= len(request_key) <= 128:
            raise ValueError("Invalid idempotency key")
        existing = self.repository.find_request(owner, request_key, request)
        if existing is not None:
            return existing
        health = self.readiness()
        if not health["route_search_ready"] or not set(request["strategies"]).intersection(
            health.get("available_strategies", [])
        ):
            raise RouteDependenciesUnavailable("ASKCOS 模型、搜索或商业库存尚未就绪，未创建任务。")
        return self.repository.create(
            owner, request, request_key=request_key, queue_limit=self.budget.queued_jobs,
        )

    def resume(self, identifier, owner):
        job = self.owned(identifier, owner)
        if job["status"] == "queued":
            return job
        if job["status"] != "waiting_for_engine":
            raise JobConflict("Task is not awaiting engine recovery")
        if not self.readiness()["route_search_ready"]:
            raise RouteDependenciesUnavailable("搜索依赖尚未恢复。")
        return self.repository.transition(identifier, "queued", expected_revision=job["revision"])

    def cancel(self, identifier, owner):
        job = self.owned(identifier, owner)
        if job["status"] == "cancelled":
            return job
        return self.repository.transition(identifier, "cancelled", expected_revision=job["revision"])
