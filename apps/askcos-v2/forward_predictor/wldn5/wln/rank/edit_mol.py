from rdkit import Chem

from wln.constants import BOND_ORDER_TO_TYPE


def fix_charges(m):
    m.UpdatePropertyCache(strict=False)
    ps = Chem.DetectChemistryProblems(m)
    for p in ps:
        if p.GetType() == "AtomValenceException":
            at = m.GetAtomWithIdx(p.GetAtomIdx())

            # Fix nitrogen -- still does not fix aromatic nitrogen
            if (
                at.GetAtomicNum() == 7
                and at.GetFormalCharge() == 0
                and at.GetExplicitValence() == 4
            ):
                at.SetFormalCharge(1)
            # Fix oxygen
            elif (
                at.GetAtomicNum() == 8
                and at.GetFormalCharge() == -1
                and at.GetExplicitValence() == 2
            ):
                at.SetFormalCharge(0)
            # fix carbon anion
            elif (
                at.GetAtomicNum() == 6
                and at.GetFormalCharge() == -1
                and at.GetExplicitValence() == 4
            ):
                at.SetFormalCharge(0)
            # Fix halides
            elif (
                at.GetAtomicNum() in (9, 17, 35, 53)
                and at.GetFormalCharge() == -1
                and at.GetExplicitValence() == 1
            ):
                at.SetFormalCharge(0)
    try:
        Chem.SanitizeMol(m)
    except Exception:
        pass

    return m


def edit_mol(rmol, edits, tatoms):
    new_mol = Chem.RWMol(rmol)
    [a.SetNumExplicitHs(0) for a in new_mol.GetAtoms()]

    amap = {}
    for atom in rmol.GetAtoms():
        amap[atom.GetIntProp("molAtomMapNumber") - 1] = atom.GetIdx()

    for x, y, t, v in edits:
        bond = new_mol.GetBondBetweenAtoms(amap[x], amap[y])

        if bond is not None:
            new_mol.RemoveBond(amap[x], amap[y])
        if t > 0:
            new_mol.AddBond(amap[x], amap[y], BOND_ORDER_TO_TYPE[t])

    try:
        if len(Chem.DetectChemistryProblems(new_mol)) > 0:
            new_mol = fix_charges(new_mol)
    except Exception:
        print("!" * 10, "ERROR IN FIXING VALENCES", "!" * 10)

    pred_mol = new_mol.GetMol()
    pred_smiles = Chem.MolToSmiles(pred_mol, isomericSmiles=False)
    pred_list = pred_smiles.split(".")
    pred_mols = []
    for pred_smiles in pred_list:
        mol = Chem.MolFromSmiles(pred_smiles)
        if mol is None:
            continue
        atom_set = set(
            [atom.GetIntProp("molAtomMapNumber") - 1 for atom in mol.GetAtoms()]
        )
        if len(atom_set & tatoms) == 0:
            continue
        for atom in mol.GetAtoms():
            atom.SetAtomMapNum(0)
        pred_mols.append(mol)

    return ".".join(
        sorted(
            [Chem.MolToSmiles(pred_mol, isomericSmiles=False) for pred_mol in pred_mols]
        )
    )


def get_product_smiles(rmol, edits, tatoms):
    smiles = edit_mol(rmol, edits, tatoms)
    if len(smiles) != 0:
        return smiles
    try:
        Chem.Kekulize(rmol)
    except Exception:
        return smiles
    return edit_mol(rmol, edits, tatoms)
