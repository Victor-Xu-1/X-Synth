"""Bind replayable reaction context to the structures actually sent to the model."""

from .reaction_input import parse_reaction_draft
from .structure_validation import canonical_structure


def condition_input_context(content: str | None, reactants: str, product: str, *, max_atoms: int) -> dict | None:
    if content is None:
        return None
    draft = parse_reaction_draft(content, "smiles", max_atoms=max_atoms)
    if draft["input_kind"] != "reaction" or not draft["reactants"] or not draft["products"]:
        raise ValueError("完整反应上下文缺少反应物或产物。")
    supplied = canonical_structure(".".join(row["smiles"] for row in draft["reactants"]), max_atoms=max_atoms)[0]
    selected = canonical_structure(product, max_atoms=max_atoms)[0]
    if supplied != canonical_structure(reactants, max_atoms=max_atoms)[0]:
        raise ValueError("完整画板与模型反应物不一致。")
    if not any(row["smiles"] == selected for row in draft["products"]):
        raise ValueError("模型所选产物不在完整画板中。")
    return {"reaction_smiles": draft["reaction_smiles"], "selected_product": selected}
