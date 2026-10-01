from __future__ import annotations

from functools import lru_cache
from hashlib import sha1
from itertools import combinations

from packages.route_schema.route_schema import RouteStep


def strategic_first_step_family(step: RouteStep) -> str | None:
    """Return an engine-independent family for the first retrosynthetic move."""
    unmasking_site = _unimolecular_unmasking_site(step)
    if unmasking_site:
        return f"route-family:first-unmasking:{unmasking_site}"

    disconnection_site = _multi_precursor_disconnection_site(step)
    if disconnection_site:
        return f"route-family:first-disconnection:{disconnection_site}"

    reaction_properties = step.metadata.get("reaction_properties")
    if isinstance(reaction_properties, dict):
        cluster_id = reaction_properties.get("cluster_id")
        if cluster_id is not None:
            return f"route-family:first-cluster:{cluster_id}"

    template_hash = str(step.metadata.get("template_hash") or "").strip()
    if template_hash:
        return f"route-family:first-template:{template_hash}"
    return None


def _unimolecular_unmasking_site(step: RouteStep) -> str | None:
    if len(step.precursors) != 1 or not step.product:
        return None
    try:
        from rdkit import Chem

        precursor = Chem.MolFromSmiles(step.precursors[0])
        product = Chem.MolFromSmiles(step.product)
        if precursor is None or product is None:
            return None
        if precursor.GetNumHeavyAtoms() <= product.GetNumHeavyAtoms():
            return None

        ranks = list(Chem.CanonicalRankAtoms(product, breakTies=False))
        signatures = []
        for match in precursor.GetSubstructMatches(
            product,
            uniquify=True,
            maxMatches=32,
        ):
            matched_precursor_atoms = set(match)
            sites = set()
            for product_index, precursor_index in enumerate(match):
                precursor_atom = precursor.GetAtomWithIdx(precursor_index)
                if any(
                    neighbor.GetIdx() not in matched_precursor_atoms
                    for neighbor in precursor_atom.GetNeighbors()
                ):
                    product_atom = product.GetAtomWithIdx(product_index)
                    sites.add(
                        (
                            int(ranks[product_index]),
                            product_atom.GetAtomicNum(),
                            int(product_atom.GetIsAromatic()),
                        )
                    )
            if sites:
                signatures.append(tuple(sorted(sites)))
        if not signatures:
            return None
        signature = repr(min(signatures)).encode("ascii")
        return sha1(signature).hexdigest()[:12]
    except Exception:
        return None


def _multi_precursor_disconnection_site(step: RouteStep) -> str | None:
    if len(step.precursors) < 2 or not step.product:
        return None
    try:
        from rdkit import Chem

        product = Chem.MolFromSmiles(step.product)
        if product is None:
            return None
        product_atom_count = product.GetNumHeavyAtoms()
        if product_atom_count < 6:
            return None

        precursor_matches = [
            matches
            for precursor in step.precursors
            if (
                matches := _maximum_common_product_matches(
                    step.product,
                    precursor,
                )
            )
        ]
        candidates: list[tuple[int, tuple[tuple[object, ...], ...]]] = []
        ranks = list(Chem.CanonicalRankAtoms(product, breakTies=False))
        for first_matches, second_matches in combinations(precursor_matches, 2):
            for first in first_matches:
                first_atoms = set(first)
                for second in second_matches:
                    second_atoms = set(second)
                    if first_atoms & second_atoms:
                        continue
                    union = first_atoms | second_atoms
                    if len(union) * 5 < product_atom_count * 3:
                        continue
                    cut_bonds = []
                    for bond in product.GetBonds():
                        begin = bond.GetBeginAtomIdx()
                        end = bond.GetEndAtomIdx()
                        if not (
                            (begin in first_atoms and end in second_atoms)
                            or (begin in second_atoms and end in first_atoms)
                        ):
                            continue
                        endpoints = []
                        for atom_index in (begin, end):
                            atom = product.GetAtomWithIdx(atom_index)
                            endpoints.append(
                                (
                                    int(ranks[atom_index]),
                                    atom.GetAtomicNum(),
                                    int(atom.GetIsAromatic()),
                                )
                            )
                        cut_bonds.append(
                            (
                                *sorted(endpoints),
                                str(bond.GetBondType()),
                            )
                        )
                    if cut_bonds:
                        candidates.append((len(union), tuple(sorted(cut_bonds))))
        if not candidates:
            return None
        max_coverage = max(coverage for coverage, _signature in candidates)
        signature = min(
            signature
            for coverage, signature in candidates
            if coverage == max_coverage
        )
        return sha1(repr(signature).encode("ascii")).hexdigest()[:12]
    except Exception:
        return None


@lru_cache(maxsize=4096)
def _maximum_common_product_matches(
    product_smiles: str,
    precursor_smiles: str,
) -> tuple[tuple[int, ...], ...]:
    from rdkit import Chem
    from rdkit.Chem import rdFMCS

    product = Chem.MolFromSmiles(product_smiles)
    precursor = Chem.MolFromSmiles(precursor_smiles)
    if product is None or precursor is None:
        return ()
    result = rdFMCS.FindMCS(
        [precursor, product],
        atomCompare=rdFMCS.AtomCompare.CompareElements,
        bondCompare=rdFMCS.BondCompare.CompareOrderExact,
        ringMatchesRingOnly=True,
        completeRingsOnly=True,
        timeout=1,
    )
    if result.canceled or result.numAtoms < 3 or not result.smartsString:
        return ()
    query = Chem.MolFromSmarts(result.smartsString)
    if query is None:
        return ()
    matches = product.GetSubstructMatches(query, uniquify=True, maxMatches=16)
    return tuple(sorted({tuple(sorted(match)) for match in matches}))
