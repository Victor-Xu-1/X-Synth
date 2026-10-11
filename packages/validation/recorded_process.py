"""One source/snapshot/outcome authority for recorded process support."""

import re
from collections import Counter

from packages.adapters.askcos.reference_identity import canonical_reference_query
from packages.adapters.askcos.reference_models import ReferenceSearchInput, ReferenceQuery

YIELD_FIELD = re.compile(r"outcomes\[(\d+)\]\.products\[\d+\]\.measurements\[\d+\]")
TIME_FIELD = re.compile(r"outcomes\[(\d+)\]\.reaction_time")


def condition_field_scope(field, outcome):
    if field == "procedure" or field.startswith(("conditions.temperature.", "conditions.pressure.")):
        return True
    matched = TIME_FIELD.fullmatch(field)
    return bool(matched and int(matched[1]) == outcome)


def recorded_support_proofs_are_valid(proofs):
    return isinstance(proofs, list) and bool(proofs) and all(
        isinstance(proof, dict) and isinstance(proof.get("id"), str) and proof["id"].strip()
        and proof.get("source") == "ORD"
        and isinstance(proof.get("snapshot"), str) and re.fullmatch(r"[a-f0-9]{64}", proof["snapshot"])
        and isinstance(proof.get("source_sha256"), str) and re.fullmatch(r"[a-f0-9]{64}", proof["source_sha256"])
        and proof.get("basis") == "exact_recorded_reaction_with_positive_yield"
        for proof in proofs
    )


def support_bound(proofs, step, reference):
    try:
        return _support_bound(proofs, step, reference)
    except (ValueError, TypeError, KeyError, AttributeError):
        return False


def reference_bound(step, reference):
    try:
        if not isinstance(reference, dict) or reference.get("has_more") is not False or reference.get("complete") is not True:
            return False
        query = canonical_reference_query(ReferenceSearchInput(product=step.product, reactants=step.precursors))
        actual = ReferenceQuery.model_validate(reference.get("query"))
        sources, refs = reference.get("sources"), reference.get("refs")
        return (actual.product == query.product and Counter(actual.reactants) == Counter(query.reactants)
                and isinstance(sources, list) and bool(sources)
                and all(isinstance(row, dict) and row.get("ready") is True for row in sources)
                and isinstance(refs, list) and all(isinstance(row, dict) for row in refs))
    except (ValueError, TypeError, KeyError, AttributeError):
        return False


def _support_bound(proofs, step, reference):
    if not recorded_support_proofs_are_valid(proofs) or not reference_bound(step, reference):
        return False
    sources, refs = reference.get("sources"), reference.get("refs")
    for proof in proofs:
        if not any(row.get("source") == "ORD" and row.get("snapshot") == proof["snapshot"] for row in sources):
            return False
        record = next((row for row in refs if row.get("id") == proof["id"] and row.get("source") == "ORD"
                   and row.get("match_scope") == "reaction_identity"
                   and (row.get("reaction_conditions_recorded") is True or row.get("reaction_procedure_recorded") is True)
                   and row.get("reaction_yields_recorded") is True
                   and isinstance(row.get("provenance"), dict)
                   and row["provenance"].get("source_sha256") == proof["source_sha256"]), None)
        if record is None:
            return False
        observations = proof.get("recorded_outcomes")
        if not isinstance(observations, list) or not observations:
            return False
        for item in observations:
            if (not isinstance(item, dict) or type(item.get("outcome_index")) is not int
                    or (record["provenance"].get("outcome_indices")
                        and item["outcome_index"] not in record["provenance"]["outcome_indices"])
                    or item.get("product_smiles") != step.product
                    or not isinstance(item.get("yield_source_field"), str)):
                return False
            matched = YIELD_FIELD.fullmatch(item["yield_source_field"])
            fields = item.get("condition_source_fields")
            if (not matched or int(matched[1]) != item["outcome_index"] or not isinstance(fields, list)
                    or not fields or not all(isinstance(field, str) and condition_field_scope(field, item["outcome_index"])
                                            and field in record.get("reaction_condition_fields", []) for field in fields)):
                return False
            expected = {"value": item.get("yield_value"), "unit": item.get("yield_unit"),
                        "method": "ord_product_measurement", "measurement_type": "YIELD",
                        "product_smiles": step.product, "source_field": item["yield_source_field"]}
            if (type(expected["value"]) not in {int, float} or not 0 < expected["value"] <= 100
                    or expected["unit"] != "%" or expected not in record.get("reaction_yield_measurements", [])):
                return False
    return True
