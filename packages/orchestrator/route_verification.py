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
from packages.validation.reaction_operations import screen_step_operations
from packages.validation.route_topology import chemical_key

from .verification_cache import VerificationCache
from .forward_review import forward_rank_receipt
from .qualification_queue import QualificationQueue, family_key
from .reference_evidence import reference_evidence, recorded_reaction_support
from .operation_review import operation_record, operation_status_accepted, operations_passed, operations_summary


def forward_match(output, product, minimum):
    if output.model != "graph2smiles_uspto_stereo" or output.evidence_type != "model_prediction":
        raise ValueError("Unexpected qualification model")
    if output.provenance is None:
        raise ValueError("Original forward provenance was not recorded")
    for row in output.all_ranked_products():
        if row.product == product:
            return row.decoder_rank, row.feasibility_score, row.joint_rank == 1 and row.feasibility_score >= minimum
    return None, None, False


class RouteVerifier:
    def __init__(self, *, forward, analyses, run_analysis, references, epoch, max_atoms):
        self.forward, self.analyses, self.run_analysis = forward, analyses, run_analysis
        self.references, self.epoch, self.max_atoms = references, epoch, max_atoms

    def _check_reference_source(self):
        if getattr(self.references, "has_library", False) and not self.references.library.status().ready:
            raise EngineUnavailable("reaction_evidence_snapshot_unavailable", recoverable=True)

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
                if output.provenance is not None:
                    return output, identifier
        result = self.run_analysis(
            owner=owner, kind="forward", inputs={"reactants": reactants, "count": 10},
            execute=lambda: self.forward.predict(reactants=reactants, count=10),
        )
        identifier = result.pop("record_id")
        output = RankedResult.model_validate(result)
        if output.reactants != reactants:
            raise ValueError("Qualification result inputs changed")
        if output.provenance is None:
            raise NativeModelError("Original forward provenance was not recorded", 502, recoverable=False)
        cache.save(reactants, identifier)
        return output, identifier

    def qualify(self, report, *, owner, minimum, maximum, plausibility, directory, interrupted, progress):
        self._check_reference_source()
        epoch = self.epoch()
        cache = VerificationCache(Path(directory) / "verification.json", owner, epoch)
        policy = RouteQualityPolicy(require_full_forward_validation=True, require_operation_validation=True)
        routes = {route.route_id: route for route in report.all_routes}
        checked = set()
        queue = QualificationQueue(report.all_routes)
        qualified_families = set()
        representatives = UnifiedRoutePool(min_routes=minimum, max_routes=maximum, quality_policy=policy)
        selected = []
        step_checks = {}
        while True:
            route = queue.next(qualified_families, representatives=selected,
                               only_improvements=len(qualified_families) >= maximum)
            if route is None:
                break
            self._check_reference_source()
            forward, references, operations = [], [], []
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
                screening = screen_step_operations(step)
                binding = (reactants, step.product,
                           tuple(sorted(chemical_key(value) for value in step.precursors)),
                           tuple(screening["template_sha256"]), tuple(screening["witness_sha256"]))
                if binding in step_checks and not step_checks[binding][0].get("record_support"):
                    saved_forward, saved_reference, saved_operation = step_checks[binding]
                    forward.append({**saved_forward, "step_id": step.step_id})
                    references.append({**saved_reference, "step_id": step.step_id})
                    operations.append({**saved_operation, "step_id": step.step_id})
                    if not saved_forward["matched"] or not operation_status_accepted(saved_operation["status"]):
                        break
                    continue
                output, identifier = self.prediction(reactants, owner, cache)
                if interrupted():
                    raise EngineUnavailable("route_verification_interrupted", recoverable=True)
                rank, score, matched = forward_match(output, step.product, plausibility)
                evidence = self.references.search(
                    ReferenceSearchInput(product=step.product, reactants=step.precursors, limit=10),
                    max_atoms=self.max_atoms,
                )
                joint_top1 = matched
                model_top1 = rank == 1 and score >= plausibility
                recorded_process = recorded_reaction_support(evidence)
                process_support = recorded_process if rank is not None and score >= plausibility else []
                support = process_support if rank is not None and not joint_top1 else []
                matched = matched or bool(support)
                forward.append({"step_id": step.step_id, "record_id": identifier, "expected_rank": rank,
                                "model": output.model, "feasibility_score": score, "matched": matched,
                                "model_top1_matched": model_top1, "joint_top1_matched": joint_top1,
                                "support_kind": "joint_ranked_top1" if joint_top1 else "record_supported_model_candidate" if support else "unsupported",
                                "record_support": support,
                                "rank_provenance": forward_rank_receipt(output, step.product, plausibility=plausibility)})
                references.append({"step_id": step.step_id, **reference_evidence(evidence),
                                   "recorded_process_support": recorded_process})
                operations.append(operation_record(step, screening, process_support))
                step_checks[binding] = (forward[-1], references[-1], operations[-1])
                if interrupted():
                    raise EngineUnavailable("route_verification_interrupted", recoverable=True)
                progress({"checked_routes": len(checked), "current_step": step.step_id,
                          "forward_records": len(cache.records)})
                if not matched or not operation_status_accepted(operations[-1]["status"]):
                    break
            if self.epoch() != epoch:
                raise EngineUnavailable("qualification_model_restarted", recoverable=True)
            forward_passed = len(forward) == len(route.steps) and all(row["matched"] for row in forward)
            operation_passed = operations_passed(operations, len(route.steps))
            passed = forward_passed and operation_passed
            review = {
                "version": 4,
                "operations": operations_summary(operations, len(route.steps)),
                "forward": {"matched_steps": sum(row["matched"] for row in forward),
                            "model_top1_matched_steps": sum(row.get("model_top1_matched", False) for row in forward),
                            "joint_top1_matched_steps": sum(row.get("joint_top1_matched", False) for row in forward),
                            "record_supported_steps": sum(bool(row.get("record_support")) for row in forward),
                            "total_steps": len(route.steps), "records": forward},
                "references": {"reaction_matched_steps": sum(row["reaction_count"] > 0 for row in references),
                               "product_matched_steps": sum(row["product_count"] > 0 for row in references),
                               "unmatched_steps": sum(not row["reaction_count"] and not row["product_count"] for row in references),
                               "unchecked_steps": len(route.steps) - len(references),
                               "truncated_steps": sum(row["has_more"] for row in references),
                               "unavailable_source_steps": sum(any(not source["ready"] for source in row["sources"]) for row in references),
                               "unknown_coverage_steps": sum(row["search_status"] == "available" for row in references),
                               "records": references},
            }
            routes[route.route_id] = replace(route, metadata={
                **route.metadata, "full_forward_prediction_validated": forward_passed,
                "forward_validation_passed": forward_passed,
                "operation_validation_passed": operation_passed,
                "forward_validation_method": "joint_sequence_fast_filter_top1_or_record_supported_candidate"
                if any(row.get("record_support") for row in forward)
                else "native_template_or_exact_record_and_joint_sequence_fast_filter_top1"
                if "exact_record_identity" in route.metadata.get("proposal_consistency_methods", [])
                else "native_template_and_joint_sequence_fast_filter_top1",
                "automated_review": review,
                "qualification_status": "qualified" if passed else (
                    "operation_evidence_required" if any(not operation_status_accepted(row["status"]) for row in operations)
                    else "unsupported" if any(row.get("reason") for row in forward) else "forward_rejected"
                ),
            })
            checked.add(route.route_id)
            if not operation_passed and forward and all(row["matched"] for row in forward):
                queue.retry_operation_evidence(route)
            if passed:
                representatives.add_routes([routes[route.route_id]])
                selected = representatives.final_candidates()
                qualified_families = {family_key(row) for row in selected}
        if interrupted():
            raise EngineUnavailable("route_verification_interrupted", recoverable=True)
        self._check_reference_source()
        qualified = UnifiedRoutePool(min_routes=minimum, max_routes=maximum, quality_policy=policy)
        qualified.add_routes(routes.values())
        result = build_route_pool_result(
            id=report.summary["id"], pool=qualified,
            source_summaries=report.summary["source_summaries"],
        )
        result.summary["verification_budget"] = {
            "routes_checked": len(checked), "route_limit": len(report.all_routes),
            "forward_inputs": len(cache.records),
            "eligible_unique_routes": queue.chemical_unique_count,
            "chemical_duplicate_routes": len(queue.duplicate_ids),
            "operation_evidence_variants_scheduled": queue.evidence_retry_count,
            "stop_reason": "maximum_qualified_families" if len(qualified_families) >= maximum else "family_candidates_exhausted",
        }
        return result

    def review(self, report, **kwargs):
        try:
            return self.qualify(report, **kwargs)
        except NativeModelError as exc:
            raise EngineUnavailable("route_verification_provider_unavailable", recoverable=exc.recoverable) from exc
        except (ReferenceError, ReactionLibraryError) as exc:
            raise EngineUnavailable("route_verification_provider_unavailable", recoverable=True) from exc
