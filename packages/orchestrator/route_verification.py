"""Automatic independent model checks and explicitly scoped reference evidence."""

from dataclasses import replace
from pathlib import Path

from packages.adapters.askcos.forward import RankedResult
from packages.adapters.askcos.native_models import NativeModelError
from packages.adapters.askcos.references import ReferenceError, ReferenceSearchInput
from packages.adapters.askcos.transport import EngineUnavailable
from packages.chemistry.forward_evaluation import validate_forward_input
from packages.knowledge_base.reaction_library import ReactionLibraryError
from packages.route_pool.pool import UnifiedRoutePool
from packages.route_pool.workflow import build_route_pool_result
from packages.validation.route_quality import RouteQualityPolicy

from .verification_cache import VerificationCache


def forward_match(output, product, minimum):
    if output.model != "graph2smiles_uspto_stereo" or output.evidence_type != "model_prediction":
        raise ValueError("Unexpected qualification model")
    for index, row in enumerate(output.products, 1):
        if row.product == product:
            return index, row.feasibility_score, index == 1 and row.feasibility_score >= minimum
    return None, None, False


def reference_evidence(response):
    exact = [row for row in response.results if row.match_scope == "reaction_identity"]
    product = [row for row in response.results if row.match_scope == "product_identity"]
    return {
        "reaction_count": len(exact), "product_count": len(product),
        "refs": [{
            "id": row.id,
            "url": row.patent_url or row.publication_url or row.source_url,
            "match_scope": row.match_scope,
            "source": row.provenance.source,
        } for row in response.results],
    }


class RouteVerifier:
    def __init__(self, *, forward, analyses, run_analysis, references, epoch, max_atoms):
        self.forward, self.analyses, self.run_analysis = forward, analyses, run_analysis
        self.references, self.epoch, self.max_atoms = references, epoch, max_atoms

    def prediction(self, reactants, owner, cache):
        identifier = cache.records.get(cache.key(reactants))
        if identifier:
            try:
                saved = self.analyses.get(identifier, owner)
            except KeyError:
                saved = None
            if saved and saved["status"] == "completed" and saved["kind"] == "forward":
                if saved["inputs"] != {"reactants": reactants, "count": 10}:
                    raise ValueError("Qualification record inputs changed")
                output = RankedResult.model_validate(saved["result"])
                if output.reactants != reactants:
                    raise ValueError("Cached qualification result inputs changed")
                return output, identifier
        result = self.run_analysis(
            owner=owner, kind="forward", inputs={"reactants": reactants, "count": 10},
            execute=lambda: self.forward.predict(reactants=reactants, count=10),
        )
        identifier = result.pop("record_id")
        output = RankedResult.model_validate(result)
        if output.reactants != reactants:
            raise ValueError("Qualification result inputs changed")
        cache.save(reactants, identifier)
        return output, identifier

    def qualify(self, report, *, owner, minimum, maximum, plausibility, directory, interrupted, progress):
        epoch = self.epoch()
        cache = VerificationCache(Path(directory) / "verification.json", owner, epoch)
        policy = RouteQualityPolicy(require_full_forward_validation=True)
        routes = {route.route_id: route for route in report.all_routes}
        checked = set()
        route_limit = maximum * 3
        while True:
            candidates = UnifiedRoutePool(min_routes=minimum, max_routes=maximum, quality_policy=RouteQualityPolicy())
            candidates.add_routes(routes.values())
            choices = [route for route in candidates.final_candidates() if route.route_id not in checked]
            if not choices:
                break
            for route in choices:
                if len(checked) >= route_limit:
                    break
                forward, references = [], []
                for step in route.steps:
                    if interrupted():
                        raise EngineUnavailable("route_verification_interrupted", recoverable=True)
                    try:
                        reactants = validate_forward_input(".".join(step.precursors), max_atoms=min(self.max_atoms, 300))
                    except ValueError:
                        forward.append({"step_id": step.step_id, "record_id": None,
                                        "expected_rank": None, "model": "graph2smiles_uspto_stereo",
                                        "feasibility_score": None, "matched": False,
                                        "reason": "unsupported_forward_input"})
                        break
                    output, identifier = self.prediction(reactants, owner, cache)
                    if interrupted():
                        raise EngineUnavailable("route_verification_interrupted", recoverable=True)
                    rank, score, matched = forward_match(output, step.product, plausibility)
                    forward.append({"step_id": step.step_id, "record_id": identifier, "expected_rank": rank,
                                    "model": output.model, "feasibility_score": score, "matched": matched})
                    evidence = self.references.search(
                        ReferenceSearchInput(product=step.product, reactants=step.precursors, limit=10),
                        max_atoms=self.max_atoms,
                    )
                    references.append({"step_id": step.step_id, **reference_evidence(evidence)})
                    if interrupted():
                        raise EngineUnavailable("route_verification_interrupted", recoverable=True)
                    progress({"checked_routes": len(checked), "current_step": step.step_id,
                              "forward_records": len(cache.records)})
                    if not matched:
                        break
                if self.epoch() != epoch:
                    raise EngineUnavailable("qualification_model_restarted", recoverable=True)
                passed = len(forward) == len(route.steps) and all(row["matched"] for row in forward)
                review = {
                    "version": 1,
                    "forward": {"matched_steps": sum(row["matched"] for row in forward),
                                "total_steps": len(route.steps), "records": forward},
                    "references": {"reaction_matched_steps": sum(row["reaction_count"] > 0 for row in references),
                                   "product_matched_steps": sum(row["product_count"] > 0 for row in references),
                                   "unmatched_steps": sum(not row["reaction_count"] and not row["product_count"] for row in references),
                                   "records": references},
                }
                routes[route.route_id] = replace(route, metadata={
                    **route.metadata, "full_forward_prediction_validated": passed,
                    "forward_validation_passed": passed,
                    "forward_validation_method": "native_template_and_graph2smiles_top1",
                    "automated_review": review,
                })
                checked.add(route.route_id)
            if len(checked) >= route_limit:
                break
        if interrupted():
            raise EngineUnavailable("route_verification_interrupted", recoverable=True)
        qualified = UnifiedRoutePool(min_routes=minimum, max_routes=maximum, quality_policy=policy)
        qualified.add_routes(routes.values())
        result = build_route_pool_result(
            id=report.summary["id"], pool=qualified,
            source_summaries=report.summary["source_summaries"],
        )
        result.summary["verification_budget"] = {
            "routes_checked": len(checked), "route_limit": route_limit,
            "forward_inputs": len(cache.records),
        }
        return result

    def review(self, report, **kwargs):
        try:
            return self.qualify(report, **kwargs)
        except (NativeModelError, ReferenceError, ReactionLibraryError) as exc:
            raise EngineUnavailable("route_verification_provider_unavailable", recoverable=True) from exc
