"""Preserve explicitly declared compound groups through a fragment-only editor."""

from collections import Counter

from rdkit import Chem

from .chemical_files import MAX_CHEMICAL_RECORDS, molecular_record
from .structure_validation import canonical_structure

ROLES = ("reactants", "products", "agents")


def _fragments(smiles: str) -> Counter:
    molecule = Chem.MolFromSmiles(smiles)
    return Counter(
        Chem.MolToSmiles(fragment, isomericSmiles=True)
        for fragment in Chem.GetMolFrags(molecule, asMols=True)
    )


def restore_compound_groups(records: dict, declared: dict, *, max_atoms: int) -> dict:
    """Merge only complete, exact native records matching a user's salt declaration."""
    if (
        not isinstance(declared, dict)
        or set(declared) != set(ROLES)
        or any(not isinstance(declared[role], list) for role in ROLES)
    ):
        raise ValueError("化合物分组声明必须分别包含三个反应角色。")
    if sum(len(declared[role]) for role in ROLES) > MAX_CHEMICAL_RECORDS:
        raise ValueError("化合物分组声明超出记录范围。")
    result = {role: list(records[role]) for role in ROLES}
    for role in ROLES:
        available = result[role]
        restored = []
        for smiles in declared[role]:
            canonical, _ = canonical_structure(smiles, max_atoms=max_atoms)
            molecule = Chem.MolFromSmiles(canonical)
            complete = molecular_record(molecule, index=1, max_atoms=max_atoms)
            if complete["components"] < 2:
                raise ValueError("分组声明只能用于包含多个组分的完整化合物。")
            remaining = _fragments(canonical)
            selected = []
            candidates = sorted(
                enumerate(available),
                key=lambda item: (
                    item[1]["smiles"] != canonical,
                    -item[1]["components"],
                    item[0],
                ),
            )
            for index, record in candidates:
                fragments = _fragments(record["smiles"])
                if fragments <= remaining:
                    selected.append(index)
                    remaining.subtract(fragments)
                    remaining = +remaining
                if not remaining:
                    break
            if remaining:
                raise ValueError(
                    "已声明的盐组分或反应角色发生改变，请重新确认完整化合物分组。"
                )
            available = [
                record
                for index, record in enumerate(available)
                if index not in selected
            ]
            restored.append(complete)
        result[role] = [
            {**record, "index": index}
            for index, record in enumerate(available + restored, 1)
        ]
    return result
