"""Parse reaction SMILES/CXSMILES as chemical objects, not dot-separated text."""

from rdkit import Chem, rdBase
from rdkit.Chem import rdChemReactions


def reaction_drawing_molecules(smiles):
    with rdBase.BlockLogs():
        reaction = rdChemReactions.ReactionFromSmarts(smiles, useSmiles=True)
        if reaction is None:
            raise ValueError("Invalid reaction structure")
        sides = []
        for templates in (reaction.GetReactants(), reaction.GetProducts()):
            molecules = []
            for template in templates:
                molecule = Chem.Mol(template)
                Chem.SanitizeMol(molecule)
                molecules.append(molecule)
            sides.append(molecules)
    return sides[0], sides[1]
