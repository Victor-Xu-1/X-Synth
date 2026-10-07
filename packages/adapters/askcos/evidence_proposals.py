"""Bounded exact ORD retrieval priors, not neural or forward-valid predictions."""

from __future__ import annotations

from dataclasses import dataclass

from rdkit import Chem

from packages.knowledge_base.reaction_library import (
    CONDITION_VARIANT_LIMIT, ReactionLibrary, ReactionLibraryError, has_measured_zero_yield,
)
from packages.knowledge_base.reaction_models import ReactionEvidence
from packages.route_schema.route_schema import RouteStep
from .reference_identity import (
    canonical_reference_query, component_multiset, parse_reference_reaction,
)
from .reference_models import ReferenceSearchInput

PROPOSAL_LIMIT = 30
PRIOR_KIND = "retrieval_prior"


@dataclass(frozen=True)
class EvidenceProposalBatch:
    results: list[dict]
    receipt: dict


def _connected(smiles: str) -> bool:
    molecule = Chem.MolFromSmiles(smiles)
    return molecule is not None and len(Chem.GetMolFrags(molecule)) == 1


def recorded_candidate_exclusion(record: ReactionEvidence) -> str | None:
    if len(record.reactants) > 30:
        return "unsupported_precursor_count"
    if len(record.products) != 1 or any(
        not _connected(smiles) for smiles in [*record.products, *record.reactants]
    ):
        return "unsupported_disconnected_compound"
    if record.conditions and any(
        item.role == "REACTANT" and item.smiles and not _connected(item.smiles)
        for item in record.conditions.inputs
    ):
        # ORD may explicitly group a salt even when reaction SMILES splits its ions.
        return "unsupported_disconnected_compound"
    if record.products[0] in record.reactants:
        return "self_loop"
    if has_measured_zero_yield(record):
        return "measured_zero_yield"
    return None


def _reaction_data(record: ReactionEvidence, snapshot: str) -> dict:
    return {
        "id": record.id,
        "reaction_smiles": record.reaction_smiles,
        "provenance": record.provenance.model_dump(mode="json"),
        "snapshot": snapshot,
    }


class EvidenceProposer:
    def __init__(self, library: ReactionLibrary):
        self.library = library

    def propose(self, product: str) -> EvidenceProposalBatch:
        status = self.library.status()
        if not status.ready:
            raise ReactionLibraryError(status.reason)
        query = canonical_reference_query(ReferenceSearchInput(product=product))
        receipt = {
            "source": "ORD", "snapshot": status.snapshot, "prior_kind": PRIOR_KIND,
            "score_semantics": "uniform_retrieval_prior_not_neural_confidence",
            "product": query.product, "limit": PROPOSAL_LIMIT,
            "condition_variant_limit": CONDITION_VARIANT_LIMIT,
            "counts_scope": "selected_distinct_precursor_records",
            "candidate_count": 0, "returned_count": 0,
            "rejected_count": 0, "unsupported_count": 0,
            "exclusions": {}, "has_more": False, "retrieval_performed": False,
        }
        if not _connected(query.product):
            receipt.update(unsupported_count=1, exclusions={"unsupported_product": 1})
            if not self.library.status().ready:
                raise ReactionLibraryError("reaction_library_invalid")
            return EvidenceProposalBatch([], receipt)
        records, has_more = self.library.precursor_records(
            query, limit=PROPOSAL_LIMIT, eligible=lambda record: recorded_candidate_exclusion(record) is None,
        )
        receipt.update(candidate_count=len(records), has_more=has_more, retrieval_performed=True)
        selected, seen = [], set()
        for record in records:
            identity = tuple(sorted(component_multiset(record.reactants).items()))
            reason = recorded_candidate_exclusion(record)
            if reason is None and identity in seen:
                reason = "duplicate_precursors"
            if reason:
                key = "unsupported_count" if reason.startswith("unsupported_") else "rejected_count"
                receipt[key] += 1
                receipt["exclusions"][reason] = receipt["exclusions"].get(reason, 0) + 1
                continue
            seen.add(identity)
            selected.append(record)
        receipt["returned_count"] = len(selected)
        score = 1 / len(selected) if selected else None
        results = [
            {
                "outcome": ".".join(record.reactants), "direction": "retro",
                "backend": "exact_match", "model_name": "ORD", "rank": rank,
                "model_score": score, "normalized_model_score": score,
                "attributes": {**receipt, "exclusions": dict(receipt["exclusions"]),
                               "rank": rank, "model_score": score,
                               "normalized_model_score": score},
                "source": {"template": None,
                           "reaction_data": _reaction_data(record, status.snapshot)},
                "reaction_id": record.id, "reaction_set": "ORD",
            }
            for rank, record in enumerate(selected, 1)
        ]
        # Check again even for an unsupported/empty candidate set, never mask source loss.
        if not self.library.status().ready:
            raise ReactionLibraryError("reaction_library_invalid")
        return EvidenceProposalBatch(results, receipt)


def verify_exact_proposal(evidence: dict, step: RouteStep, library: ReactionLibrary) -> bool:
    """Verify original recorded identity only; this grants no forward-valid claim."""
    status = library.status()
    if not status.ready:
        raise ReactionLibraryError(status.reason)
    try:
        if (
            evidence["backend"] != "exact_match" or evidence["model_name"] != "ORD"
            or evidence["direction"] != "retro" or evidence["reaction_set"] != "ORD"
            or evidence["attributes"]["prior_kind"] != PRIOR_KIND
            or evidence["attributes"]["source"] != "ORD"
            or evidence["attributes"]["snapshot"] != status.snapshot
            or evidence["source"]["template"] is not None
        ):
            return False
        data = evidence["source"]["reaction_data"]
        query = canonical_reference_query(ReferenceSearchInput(
            product=step.product, reactants=step.precursors,
        ))
        record = library.get_record(evidence["reaction_id"], query)
        if record is None or recorded_candidate_exclusion(record) or data != _reaction_data(record, status.snapshot):
            return False
        if (
            not _connected(query.product) or any(not _connected(s) for s in query.reactants)
            or component_multiset(query.reactants) != component_multiset(record.reactants)
        ):
            return False
        reactants, products, agents = parse_reference_reaction(step.reaction_smiles)
        return (
            all(_connected(s) for s in [*reactants, *products])
            and component_multiset(reactants) == component_multiset(record.reactants)
            and component_multiset(products) == component_multiset(record.products)
            and (not agents or component_multiset(agents) == component_multiset(record.agents))
        )
    except (KeyError, TypeError, ValueError, AttributeError):
        return False
