"""Real ORD/SQLite/RDKit; mutations below are adversarial, not scientific examples."""

from copy import deepcopy
from dataclasses import replace
import json
from pathlib import Path
import sqlite3
from contextlib import closing

import pytest
from rdkit import Chem

from packages.adapters.askcos.evidence_proposals import EvidenceProposer, verify_exact_proposal
from packages.adapters.askcos.reference_identity import (
    canonical_reference_query, parse_reference_reaction,
)
from packages.adapters.askcos.reference_models import ReferenceSearchInput
from packages.knowledge_base.reaction_library import ReactionLibrary, ReactionLibraryError, compile_reaction_library
from packages.knowledge_base.reaction_models import ReactionEvidence
from packages.route_schema.route_schema import RouteStep

FIXTURE = Path(__file__).parents[1] / "fixtures/reactions/ord-astra-zeneca.json"


def deposited():
    return ReactionEvidence.model_validate_json(FIXTURE.read_text(encoding="utf-8"))


def adversarial(label, *, reaction=None, **changes):
    data = deposited().model_dump(mode="json")
    data["id"] += "-adversarial-" + label
    data["provenance"]["record_id"] = data["id"]
    if reaction:
        reactants, products, agents = parse_reference_reaction(reaction)
        data.update(reaction_smiles=reaction, reactants=reactants, products=products, agents=agents)
        for item in data["reported_yields"]:
            item["product_smiles"] = products[0]
    return ReactionEvidence.model_validate({**data, **changes})


def compiled(tmp_path, records=None):
    records = records or [deposited()]
    path = tmp_path / "reactions.sqlite"
    provenance = deposited().provenance
    compile_reaction_library(records, path, sources=[{
        "path": provenance.source_path, "sha256": provenance.source_sha256,
    }])
    return ReactionLibrary(path)


def query(record):
    return canonical_reference_query(ReferenceSearchInput(product=".".join(record.products)))


def step_for(record):
    return RouteStep("ord-step", ".".join(record.reactants) + ">>" + record.products[0],
                     record.reactants, record.products[0], "askcos:exact_match:ORD")


def test_deposited_record_proposal_and_original_record_verification(tmp_path):
    record, library = deposited(), compiled(tmp_path)
    batch = EvidenceProposer(library).propose(record.products[0])
    assert batch.receipt["candidate_count"] == batch.receipt["returned_count"] == 1
    assert batch.receipt["rejected_count"] == batch.receipt["unsupported_count"] == 0
    assert batch.receipt["has_more"] is False
    result = batch.results[0]
    assert result["outcome"].split(".") == record.reactants
    assert not set(record.agents) & set(result["outcome"].split("."))
    assert (result["backend"], result["direction"], result["model_name"]) == ("exact_match", "retro", "ORD")
    assert result["model_score"] == result["normalized_model_score"] == 1
    assert result["attributes"]["prior_kind"] == "retrieval_prior"
    assert "not_neural_confidence" in result["attributes"]["score_semantics"]
    data = result["source"]["reaction_data"]
    assert result["source"]["template"] is None
    assert data["reaction_smiles"] == record.reaction_smiles
    assert data["provenance"] == record.provenance.model_dump(mode="json")
    assert "yield" not in result and "confidence" not in result
    assert verify_exact_proposal(result, step_for(record), library)
    assert verify_exact_proposal(result, replace(step_for(record), reaction_smiles=record.reaction_smiles), library)
    assert library.get_record(record.id, query(record)).reported_yields == record.reported_yields
    assert library.get_record("missing", query(record)) is None
    other = canonical_reference_query(ReferenceSearchInput(product=record.products[0].replace("(F)", "(Cl)", 1)))
    assert library.get_record(record.id, other) is None


def test_condition_variants_cannot_hide_an_alternate_precursor(tmp_path):
    record = deposited()
    variants = [adversarial(f"variant-{i:03}") for i in range(40)]
    alternate = adversarial("alternate", reaction=record.reaction_smiles.replace("(Br)", "(Cl)", 1))
    library = compiled(tmp_path, [*variants, alternate])
    records, more = library.precursor_records(query(record), limit=2)
    assert len(records) == 2 and not more
    assert {tuple(r.reactants) for r in records} == {tuple(record.reactants), tuple(alternate.reactants)}
    assert library.precursor_records(query(record), limit=1)[1]
    results = EvidenceProposer(library).propose(record.products[0]).results
    assert len(results) == 2 and {r["model_score"] for r in results} == {0.5}


def test_unsupported_condition_variant_does_not_hide_supported_record(tmp_path):
    bad = adversarial("aaa-grouped-salt").model_copy(deep=True)
    bad.conditions.inputs.append(bad.conditions.inputs[0].model_copy(update={
        "role": "REACTANT", "smiles": "[Na+].[Cl-]",
    }))
    supported = adversarial("zzz-connected")
    batch = EvidenceProposer(compiled(tmp_path, [bad, supported])).propose(supported.products[0])
    assert len(batch.results) == 1
    assert batch.results[0]["reaction_id"] == supported.id
    assert batch.receipt["unsupported_count"] == 0 and not batch.receipt["has_more"]


def test_zero_percent_uses_alternative_or_exposes_truncation(tmp_path):
    record = deposited()
    zero = [r.model_dump(mode="json") for r in record.reported_yields]
    zero[0].update(value=0, text='{"percentage":{"value":0},"type":"YIELD"}')
    records = [adversarial(f"{i:03}-zero", reported_yields=zero) for i in range(9)]
    positive = adversarial("zzz-positive")
    library = compiled(tmp_path, [records[0], positive])
    result = EvidenceProposer(library).propose(record.products[0]).results[0]
    assert result["reaction_id"] == positive.id
    truncated = compiled(tmp_path / "truncated", [*records, positive])
    batch = EvidenceProposer(truncated).propose(record.products[0])
    assert batch.results == [] and batch.receipt["has_more"]
    assert batch.receipt["exclusions"] == {"measured_zero_yield": 1}
    unknown = adversarial("unknown", reported_yields=[])
    assert EvidenceProposer(compiled(tmp_path / "unknown", [unknown])).propose(record.products[0]).results


@pytest.mark.parametrize("boundary", ["self_loop", "grouped_salt", "recorded_salt", "product_salt", "precursor_count"])
def test_unsupported_identity_boundaries_are_accounted_not_proposed(tmp_path, boundary):
    record = deposited()
    reaction = record.reaction_smiles
    if boundary == "self_loop":
        reaction = record.products[0] + ">>" + record.products[0]
    elif boundary == "grouped_salt":
        reaction = "(" + record.reactants[0] + ".[Cl-])." + record.reactants[1] + ">>" + record.products[0]
    elif boundary == "product_salt":
        reaction = ".".join(record.reactants) + ">>" + record.products[0] + ".[Cl-]"
    elif boundary == "precursor_count":
        reaction = ".".join([record.reactants[0]] * 31) + ">>" + record.products[0]
    changes = {}
    if boundary == "recorded_salt":
        changes["conditions"] = record.conditions.model_dump(mode="json")
        changes["conditions"]["inputs"][1]["smiles"] += ".[Cl-]"
    mutated = adversarial(boundary, reaction=reaction, **changes)
    batch = EvidenceProposer(compiled(tmp_path, [mutated])).propose(".".join(mutated.products))
    assert not batch.results
    assert batch.receipt["rejected_count" if boundary == "self_loop" else "unsupported_count"] == 1
    if boundary == "precursor_count":
        assert batch.receipt["exclusions"] == {"unsupported_precursor_count": 1}


@pytest.mark.parametrize("mutation", ["backend", "snapshot", "id", "provenance", "original", "template", "missing"])
def test_metadata_cannot_substitute_for_library_authority(tmp_path, mutation):
    record, library = deposited(), compiled(tmp_path)
    evidence = deepcopy(EvidenceProposer(library).propose(record.products[0]).results[0])
    if mutation == "backend":
        evidence["backend"] = "template_relevance"
    elif mutation == "snapshot":
        evidence["attributes"]["snapshot"] = "0" * 64
    elif mutation == "id":
        evidence["reaction_id"] = "missing"
    elif mutation == "provenance":
        evidence["source"]["reaction_data"]["provenance"]["source_sha256"] = "0" * 64
    elif mutation == "original":
        evidence["source"]["reaction_data"]["reaction_smiles"] = step_for(record).reaction_smiles
    elif mutation == "template":
        evidence["source"]["template"] = "fabricated"
    else:
        del evidence["source"]
    assert not verify_exact_proposal(evidence, step_for(record), library)


@pytest.mark.parametrize("identity", ["isotope", "charge", "multiplicity", "agent", "product", "reaction"])
def test_full_step_identity_is_checked_including_multiplicity(tmp_path, identity):
    record, library = deposited(), compiled(tmp_path)
    evidence = EvidenceProposer(library).propose(record.products[0]).results[0]
    step = step_for(record)
    if identity in {"isotope", "charge"}:
        precursor = step.precursors[0].replace("C", "[13CH3]", 1) if identity == "isotope" else step.precursors[0].replace("N1", "[NH+]1", 1)
        step = replace(step, precursors=[precursor, step.precursors[1]])
    elif identity in {"multiplicity", "agent"}:
        step = replace(step, precursors=[*step.precursors, step.precursors[0] if identity == "multiplicity" else record.agents[0]])
    elif identity == "product":
        step = replace(step, product=step.product.replace("(F)", "(Cl)", 1))
    else:
        step = replace(step, reaction_smiles=step.reaction_smiles.replace("(Br)", "(Cl)", 1))
    assert not verify_exact_proposal(evidence, step, library)


def test_mapping_is_preserved_and_stereo_is_not_relaxed(tmp_path):
    record = deposited()
    molecule = Chem.MolFromSmiles(record.products[0])
    for i, atom in enumerate(molecule.GetAtoms(), 1):
        atom.SetAtomMapNum(i)
    mapped = Chem.MolToSmiles(molecule, isomericSmiles=True)
    record = adversarial("mapped-stereo", reaction=record.reaction_smiles.replace(record.products[0], mapped).replace("CC(C)N1", "C[C@H](F)N1", 1))
    library = compiled(tmp_path, [record])
    evidence = EvidenceProposer(library).propose(mapped).results[0]
    assert evidence["source"]["reaction_data"]["reaction_smiles"] == record.reaction_smiles
    assert verify_exact_proposal(evidence, step_for(record), library)
    inverted = [s.replace("@", "@@", 1) for s in record.reactants]
    assert not verify_exact_proposal(evidence, replace(step_for(record), precursors=inverted), library)


@pytest.mark.parametrize("failure", ["absent", "invalid", "changed", "payload", "signature", "identifier", "unsupported_product"])
def test_source_failures_raise_instead_of_empty_candidates(tmp_path, failure):
    record = deposited()
    library = compiled(tmp_path)
    path = library.path
    if failure in {"absent", "invalid"}:
        library = ReactionLibrary(tmp_path / "missing.sqlite") if failure == "absent" else ReactionLibrary(None)
    elif failure in {"changed", "unsupported_product"}:
        path.chmod(0o644)
        with path.open("ab") as handle:
            handle.write(b"adversarial-change")
    else:
        path.chmod(0o644)
        with closing(sqlite3.connect(path)) as connection:
            field, value = ("reactants", "0" * 64) if failure == "signature" else ("id", "wrong")
            if failure == "payload":
                data = record.model_dump(mode="json")
                data["provenance"]["source_sha256"] = "0" * 64
                field, value = "payload", json.dumps(data)
            connection.execute(f"UPDATE reactions SET {field}=?", (value,))
            connection.commit()
        library = ReactionLibrary(path)
    with pytest.raises(ReactionLibraryError):
        product = record.products[0] + ".[Cl-]" if failure == "unsupported_product" else record.products[0]
        EvidenceProposer(library).propose(product)
    with pytest.raises(ReactionLibraryError):
        library.get_record("wrong" if failure == "identifier" else record.id, query(record))
