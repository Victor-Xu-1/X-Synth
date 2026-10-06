"""Recover occurrence counts only from disjoint, exact source compound groups."""

from collections import Counter
from dataclasses import dataclass

from rdkit import Chem, rdBase


class PrecursorMultiplicityError(ValueError):
    pass


@dataclass(frozen=True)
class PrecursorOccurrences:
    precursors: tuple[str, ...]
    multiplicities: tuple[int, ...]

    def evidence(self, graph_precursors, source_node_ids, raw_reactants):
        return {"version": 1, "graph_precursors": list(graph_precursors),
                "source_node_ids": list(source_node_ids), "raw_reactants": raw_reactants,
                "multiplicities": list(self.multiplicities)}


def _fragments(smiles, canonical):
    with rdBase.BlockLogs():
        molecule = Chem.MolFromSmiles(smiles)
        if molecule is None:
            raise PrecursorMultiplicityError("reaction_structure_mismatch")
        fragments = Chem.GetMolFrags(molecule, asMols=True)
    return Counter(canonical(Chem.MolToSmiles(fragment, isomericSmiles=True)) for fragment in fragments)


def reconcile_precursor_occurrences(graph_precursors, raw_reactants, *, canonical):
    raw = canonical(raw_reactants)
    groups = [canonical(value) for value in graph_precursors]
    if not raw or not groups or not all(groups):
        raise PrecursorMultiplicityError("reaction_structure_mismatch")
    if canonical(".".join(graph_precursors)) == raw:
        return PrecursorOccurrences(tuple(graph_precursors), (1,) * len(groups))
    counters = [_fragments(value, canonical) for value in groups]
    seen = set()
    for counter in counters:
        if seen.intersection(counter):
            raise PrecursorMultiplicityError("ambiguous_precursor_multiplicity")
        seen.update(counter)
    raw_counts = _fragments(raw, canonical)
    if seen != set(raw_counts):
        raise PrecursorMultiplicityError("reaction_structure_mismatch")
    counts = []
    for counter in counters:
        factors = {raw_counts[fragment] // count for fragment, count in counter.items()}
        if (len(factors) != 1 or 0 in factors
                or any(raw_counts[fragment] % count for fragment, count in counter.items())):
            raise PrecursorMultiplicityError("reaction_structure_mismatch")
        counts.append(factors.pop())
    expanded = tuple(value for value, count in zip(graph_precursors, counts, strict=True)
                     for _ in range(count))
    if canonical(".".join(expanded)) != raw:
        raise PrecursorMultiplicityError("reaction_structure_mismatch")
    return PrecursorOccurrences(expanded, tuple(counts))
