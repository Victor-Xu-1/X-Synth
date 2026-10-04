"""Exact molecular identity and source-only USPTO evidence projection."""

from __future__ import annotations

import math
import re
from collections import Counter
from datetime import UTC, datetime
from typing import Literal

from rdkit import Chem, rdBase
from rdkit.Chem import rdChemReactions

from packages.workspace.structure_validation import canonical_structure

from .reference_models import (
    MAX_CANDIDATES,
    MAX_REACTION_LENGTH,
    MAX_REFERENCE_ATOMS,
    MAX_RESULTS,
    SOURCE,
    ReactionReference,
    ReferenceError,
    ReferenceProvenance,
    ReferenceQuery,
    ReferenceSearchInput,
    ReferenceSearchResponse,
    ReportedYield,
)


def _canonical_molecule(molecule: Chem.Mol) -> str:
    molecule = Chem.Mol(molecule)
    if molecule.GetStereoGroups() or any(
        atom.GetAtomicNum() == 0 or atom.HasQuery() for atom in molecule.GetAtoms()
    ):
        raise ValueError("A definite molecular structure is required")
    if not 0 < molecule.GetNumAtoms() <= MAX_REFERENCE_ATOMS:
        raise ValueError("Reference structure exceeds the atom budget")
    # Mapping is bookkeeping, not identity; isotopes, stereo, charge and salts remain.
    for atom in molecule.GetAtoms():
        atom.SetAtomMapNum(0)
    Chem.SanitizeMol(molecule)
    molecule = Chem.RemoveHs(molecule)
    return canonical_structure(
        Chem.MolToSmiles(molecule, isomericSmiles=True),
        max_atoms=MAX_REFERENCE_ATOMS,
    )[0]


def canonical_reference_query(
    body: ReferenceSearchInput, *, max_atoms: int = MAX_REFERENCE_ATOMS
) -> ReferenceQuery:
    limit = min(max_atoms, MAX_REFERENCE_ATOMS)
    normalized = []
    atoms = 0
    with rdBase.BlockLogs():
        for smiles in [body.product, *body.reactants]:
            canonical, count = canonical_structure(smiles, max_atoms=limit)
            atoms += count
            molecule = Chem.MolFromSmiles(canonical)
            normalized.append(_canonical_molecule(molecule))
    if atoms > limit:
        raise ValueError("Reference query exceeds the total atom budget")
    return ReferenceQuery(product=normalized[0], reactants=normalized[1:])


def component_multiset(structures: list[str]) -> Counter:
    return Counter(fragment for smiles in structures for fragment in smiles.split("."))


def parse_reference_reaction(smiles: str) -> tuple[list[str], list[str], list[str]]:
    if not isinstance(smiles, str) or not 0 < len(smiles) <= MAX_REACTION_LENGTH:
        raise ValueError("Invalid reference reaction")
    with rdBase.BlockLogs():
        reaction = rdChemReactions.ReactionFromSmarts(smiles, useSmiles=True)
        if (
            reaction is None
            or not reaction.GetNumReactantTemplates()
            or not reaction.GetNumProductTemplates()
        ):
            raise ValueError("Invalid reference reaction")
        sides = (reaction.GetReactants(), reaction.GetProducts(), reaction.GetAgents())
        if (
            sum(mol.GetNumAtoms() for side in sides for mol in side)
            > MAX_REFERENCE_ATOMS
        ):
            raise ValueError("Reference reaction exceeds the atom budget")
        return tuple([_canonical_molecule(mol) for mol in side] for side in sides)


def reaction_match_scope(
    query: ReferenceQuery, reactants: list[str]
) -> Literal["reaction_identity", "product_identity"]:
    return (
        "reaction_identity"
        if query.reactants
        and component_multiset(query.reactants) == component_multiset(reactants)
        else "product_identity"
    )


def product_recall_key(product: str) -> str:
    molecule = Chem.MolFromSmiles(product)
    for atom in molecule.GetAtoms():
        atom.SetIsotope(0)
        atom.SetAtomMapNum(0)
    return Chem.MolToSmiles(molecule, isomericSmiles=True)


def _source_text(value, *, max_length: int) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise TypeError("Invalid reference metadata")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Nonfinite reference metadata")
    text = str(value).strip()
    if len(text) > max_length:
        raise ValueError("Reference metadata exceeds its budget")
    return text or None


def _reported_yields(document: dict) -> list[ReportedYield]:
    values = []
    for method in ("text_mined_yield", "calculated_yield"):
        text = _source_text(document.get(method), max_length=4096)
        if text is None:
            continue
        match = re.fullmatch(r"([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(%)?", text)
        number = float(match[1]) if match else None
        if number is not None and not math.isfinite(number):
            number = None
        values.append(
            ReportedYield(
                value=number,
                unit="%" if match and match[2] else None,
                method=method,
                text=text,
            )
        )
    return values


def _patent_url(patent: str | None) -> str | None:
    if patent and re.fullmatch(r"US\d{5,14}(?:[A-Z]\d?)?", patent):
        return "https://patents.google.com/patent/" + patent
    return None


def reference_from_document(
    document: dict, query: ReferenceQuery
) -> ReactionReference | None:
    if document.get("template_set") != SOURCE:
        raise ValueError("Only USPTO_FULL reference records are permitted")
    reactants, products, agents = parse_reference_reaction(
        document.get("reaction_smiles")
    )
    product = canonical_structure(".".join(products), max_atoms=MAX_REFERENCE_ATOMS)[0]
    if product != query.product:
        return None
    identifier = _source_text(document.get("_id"), max_length=160)
    if identifier is None:
        raise ValueError("Reference record has no identifier")
    patent = _source_text(document.get("patent_number"), max_length=160)
    patent_url = _patent_url(patent)
    year_text = _source_text(document.get("year"), max_length=16)
    year = int(year_text) if year_text and re.fullmatch(r"\d{4}", year_text) else None
    yields = _reported_yields(document)
    return ReactionReference(
        id=identifier,
        reaction_smiles=document["reaction_smiles"],
        reactants=reactants,
        products=products,
        agents=agents,
        match_scope=reaction_match_scope(query, reactants),
        patent_number=patent,
        patent_url=patent_url,
        paragraph=_source_text(document.get("paragraph_num"), max_length=160),
        year=year,
        reported_yields=yields,
        conditions=None,
        provenance=ReferenceProvenance(
            record_id=identifier,
            yield_extraction_fields=[item.method for item in yields],
            patent_url_basis="record_patent_number" if patent_url else None,
        ),
    )


def reference_search_response(
    documents: list[dict],
    query: ReferenceQuery,
    *,
    limit: int,
    requested: ReferenceQuery | None = None,
) -> ReferenceSearchResponse:
    if len(documents) > MAX_CANDIDATES or not 1 <= limit <= MAX_RESULTS:
        raise ReferenceError("reference_candidate_budget_exceeded")
    matches = []
    try:
        for document in documents:
            record = reference_from_document(document, query)
            if record is not None:
                matches.append(record)
    except (ValueError, RuntimeError, TypeError, KeyError) as exc:
        raise ReferenceError("reference_record_invalid") from exc
    matches.sort(key=lambda item: (item.match_scope != "reaction_identity", item.id))
    results = matches[:limit]
    return ReferenceSearchResponse(
        query=query,
        requested=(query if requested is None else requested).model_copy(deep=True),
        results=results,
        count=len(results),
        has_more=len(matches) > limit,
        retrieved_at=datetime.now(UTC).isoformat(),
    )


def _verify_native_record(record: ReactionReference, query: ReferenceQuery) -> None:
    reactants, products, agents = parse_reference_reaction(record.reaction_smiles)
    product = canonical_structure(".".join(products), max_atoms=MAX_REFERENCE_ATOMS)[0]
    yields = _reported_yields(
        {item.method: item.text for item in record.reported_yields}
    )
    if (
        product != query.product
        or record.reactants != reactants
        or record.products != products
        or record.agents != agents
        or record.match_scope != reaction_match_scope(query, reactants)
        or record.id != record.provenance.record_id
        or record.reported_yields != yields
        or record.provenance.yield_extraction_fields != [item.method for item in yields]
        or record.patent_url != _patent_url(record.patent_number)
        or record.provenance.patent_url_basis
        != ("record_patent_number" if record.patent_url else None)
    ):
        raise ValueError("Native reference identity verification failed")
