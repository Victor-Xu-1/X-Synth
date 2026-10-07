"""Reconstruct native template proposals and group actual target bond edits."""

import hashlib
import json
from dataclasses import replace
from functools import lru_cache

from rdchiral.initialization import rdchiralReactants, rdchiralReaction
from rdchiral.main import rdchiralRun
from rdkit import Chem

from packages.adapters.stock.commercial_stock import canonicalize_smiles
from packages.adapters.askcos.evidence_proposals import verify_exact_proposal


def templates(step):
    for evidence in step.metadata.get("model_metadata", []):
        template = (evidence.get("source") or {}).get("template") or {}
        smarts = template.get("reaction_smarts")
        if isinstance(smarts, str) and ">>" in smarts:
            yield smarts


@lru_cache(maxsize=2048)
def reconstruct(smarts, precursors, target):
    product_pattern, precursor_pattern = smarts.split(">>")
    try:
        reaction = rdchiralReaction(f"({precursor_pattern})>>({product_pattern})")
        predicted = rdchiralRun(reaction, rdchiralReactants(precursors))
        return canonicalize_smiles(target) in {
            canonicalize_smiles(value) for value in predicted
        }
    except (ValueError, RuntimeError, IndexError, KeyError, AttributeError):
        return False


def bond_family(smarts, product):
    left, right = smarts.split(">>")
    query = Chem.MolFromSmarts(left)
    precursors = Chem.MolFromSmarts(right)
    molecule = Chem.MolFromSmiles(canonicalize_smiles(product))
    if query is None or precursors is None or molecule is None:
        return None
    match = molecule.GetSubstructMatch(query)
    if not match:
        return None
    ranks = list(Chem.CanonicalRankAtoms(molecule, breakTies=False))
    positions = {
        atom.GetAtomMapNum(): match[atom.GetIdx()]
        for atom in query.GetAtoms()
        if atom.GetAtomMapNum()
    }

    def bonds(mol):
        result = {}
        for bond in mol.GetBonds():
            start, end = (
                bond.GetBeginAtom().GetAtomMapNum(),
                bond.GetEndAtom().GetAtomMapNum(),
            )
            if start and end:
                result[tuple(sorted((start, end)))] = str(bond.GetBondType())
        return result

    product_bonds, precursor_bonds = bonds(query), bonds(precursors)
    edits = []
    for pair in product_bonds.keys() | precursor_bonds.keys():
        before, after = precursor_bonds.get(pair), product_bonds.get(pair)
        if before == after or any(index not in positions for index in pair):
            continue
        edits.append(
            (tuple(sorted(ranks[positions[index]] for index in pair)), before, after)
        )
    if not edits:
        return None
    digest = hashlib.sha256(
        json.dumps(
            sorted(edits, key=lambda edit: json.dumps(edit)), sort_keys=True
        ).encode()
    ).hexdigest()[:16]
    return "target-bond-family:" + digest


def validate_native_routes(routes, *, evidence_library=None):
    checked = []
    for route in routes:
        results = []
        family = None
        methods = []
        for index, step in enumerate(route.steps):
            matching = [
                smarts
                for smarts in templates(step)
                if reconstruct(smarts, ".".join(step.precursors), step.product)
            ]
            recorded = [
                evidence for evidence in step.metadata.get("model_metadata", [])
                if evidence.get("backend") == "exact_match" and evidence.get("model_name") == "ORD"
            ]
            exact = bool(recorded) and evidence_library is not None and all(
                verify_exact_proposal(evidence, step, evidence_library) for evidence in recorded
            )
            consistent = bool(matching) or exact
            if recorded and not exact:
                consistent = False
            results.append(consistent)
            methods.append("template_reconstruction" if matching else "exact_record_identity" if exact else "unmatched")
            if index == 0 and matching:
                family = bond_family(matching[0], step.product)
            elif index == 0 and exact:
                # Unmapped records cannot establish distinct bond-change families.
                family = "recorded-target-family:" + hashlib.sha256(
                    canonicalize_smiles(step.product).encode()
                ).hexdigest()[:16]
        checked.append(
            replace(
                route,
                family_key=family or route.family_key,
                metadata={
                    **route.metadata,
                    "forward_validation_passed": bool(results) and all(results),
                    "forward_validation_method": "native_template_or_exact_record_consistency"
                    if "exact_record_identity" in methods else "native_template_reconstruction",
                    "full_forward_prediction_validated": False,
                    "forward_validation_steps": results,
                    "proposal_consistency_methods": methods,
                },
            )
        )
    return checked
