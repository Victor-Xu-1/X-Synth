"""Single-reaction RXN interchange; reaction files are never whole-route claims."""

from rdkit import Chem, rdBase
from rdkit.Chem import rdChemReactions, rdDepictor

from .chemical_files import MAX_CHEMICAL_RECORDS, chemical_text, molecular_record
from .structure_validation import canonical_structure


def _concrete_molecule(template):
    # RXN turns concrete elements/charges into query atoms. Re-read their CTAB;
    # actual atom lists and query bonds remain queries and are rejected downstream.
    return Chem.MolFromMolBlock(
        Chem.MolToMolBlock(template, forceV3000=True),
        sanitize=False,
        removeHs=False,
        strictParsing=True,
    )


def parse_reaction_file(content: str, *, max_atoms: int) -> dict:
    text = chemical_text(content)
    if not text.lstrip().startswith("$RXN") or text.count("$RXN") != 1:
        raise ValueError("仅支持包含一个反应的 MDL RXN 文件。")
    try:
        with rdBase.BlockLogs():
            reaction = rdChemReactions.ReactionFromRxnBlock(
                text, sanitize=False, removeHs=False, strictParsing=True
            )
            if reaction is None:
                raise ValueError("无法解析 RXN 反应文件。")
            groups = {
                "reactants": reaction.GetReactants(),
                "products": reaction.GetProducts(),
                "agents": reaction.GetAgents(),
            }
            if not groups["reactants"] or not groups["products"]:
                raise ValueError("RXN 文件必须同时包含反应物和产物。")
            if sum(len(group) for group in groups.values()) > MAX_CHEMICAL_RECORDS:
                raise ValueError("一个 RXN 文件最多包含 100 条结构。")
            result = {
                name: [
                    molecular_record(
                        _concrete_molecule(molecule), index=index, max_atoms=max_atoms
                    )
                    for index, molecule in enumerate(group, 1)
                ]
                for name, group in groups.items()
            }
    except (RuntimeError, ValueError) as exc:
        raise ValueError("RXN 文件不能作为确定反应解析：" + str(exc)) from exc
    return {"format": "rxn", **result}


def export_reaction_file(
    reactants: list[str], product: str, agents: list[str], *, max_atoms: int
) -> dict:
    if not reactants or len(reactants) + len(agents) + 1 > MAX_CHEMICAL_RECORDS:
        raise ValueError("RXN 导出必须有反应物、一个产物且不超过 100 条结构。")
    structures = {"reactants": reactants, "products": [product], "agents": agents}
    canonical = {
        group: [
            canonical_structure(smiles, max_atoms=max_atoms)[0] for smiles in values
        ]
        for group, values in structures.items()
    }
    with rdBase.BlockLogs():
        reaction = rdChemReactions.ChemicalReaction()
        for group, values in canonical.items():
            add = {
                "reactants": reaction.AddReactantTemplate,
                "products": reaction.AddProductTemplate,
                "agents": reaction.AddAgentTemplate,
            }[group]
            for smiles in values:
                molecule = Chem.MolFromSmiles(smiles)
                molecular_record(molecule, index=1, max_atoms=max_atoms)
                rdDepictor.Compute2DCoords(molecule)
                add(molecule)
        content = rdChemReactions.ReactionToRxnBlock(
            reaction, separateAgents=True, forceV3000=True
        )
    checked = parse_reaction_file(content, max_atoms=max_atoms)
    for group, values in canonical.items():
        if values != [record["smiles"] for record in checked[group]]:
            raise ValueError("该反应不能无损导出为 RXN。")
    return {"format": "rxn", "content": content, "media_type": "chemical/x-mdl-rxnfile"}
