import rdkit.Chem as Chem
from rdkit.Chem import rdmolops


def remove_atom_mapping(smiles):
    """Removes atom map numbers and stereochemistry from the input SMILES"""
    mol = Chem.MolFromSmiles(smiles)
    for atom in mol.GetAtoms():
        atom.ClearProp("molAtomMapNumber")
    # Remove stereochemistry since WLN doesn't support it
    rdmolops.RemoveStereochemistry(mol)
    return Chem.MolToSmiles(mol, isomericSmiles=False)


class WLNAtomMapper:
    """Atom mapping tool based on WLNForwardPredictor.

    Attributes:
        model (askcos.synthetic.evaluation.wln.WLNForwardPredictor):
            Template-free forward predictor
    """

    def __init__(self, model=None, **kwargs):
        """Initializes TemplateFreeNeuralNetScorer.

        Args:
            model (obj, optional): existing model instance with predict method
            **kwargs: Unused
        """
        self.model = model
        if model is None:
            self.load()

    def load(self, model_name="uspto_500k"):
        """Load machine learning models"""
        from askcos.synthetic.evaluation.wln import WLNForwardPredictor # I think it should be askcos.synthetic.evaluation.wln.predict?

        self.model = WLNForwardPredictor()
        self.model.load(model_name=model_name)

    def get_wln_results(self, reactants, target):
        """Evaluates possible reaction outcomes for given reactants.

        Selects outcome which matches expected target.

        Args:
            reactants (str): SMILES string of reactants
            target (str): SMILES string of desired target

        Returns:
            (str, str): atom mapped reactants and products
        """
        mapped_reactants, outcomes = self.model.predict(
            reactants, top_n=1000, atommap=True
        )

        if not outcomes:
            return mapped_reactants, ""
        for i, outcome in enumerate(outcomes):
            for mapped_products in outcome["smiles"].split("."):
                if remove_atom_mapping(mapped_products) == target:
                    return mapped_reactants, mapped_products

        # If we're here, then we didn't find the target in outcomes
        return mapped_reactants, ""

    def evaluate(self, reaction_smiles):
        """Evaluate atom mapping for the input reaction SMILES."""
        reactants, agents, products = reaction_smiles.split(">")
        reactants_canon = remove_atom_mapping(reactants)
        products_canon = remove_atom_mapping(products)
        reactants_mapped, products_mapped = self.get_wln_results(
            reactants_canon, products_canon
        )

        if not products_mapped:
            print("Failed to find the atom mapping.")
            return ">>"
        else:
            return ">".join([reactants_mapped, agents, products_mapped])


if __name__ == "__main__":
    mapper = WLNAtomMapper()

    rsmi = "[C:8]([O:9][C:10](=[O:11])[N:15]1[CH2:16][CH2:17][CH:18]([CH2:21][O:22][C:23](=[O:24])[CH:25]2[N:26]3[C:27](=[O:38])[N:28]([O:33][S:34](=[O:35])(=[O:36])[OH:37])[CH:29]([CH2:30][CH2:31]2)[CH2:32]3)[CH2:19][CH2:20]1)([CH3:12])([CH3:13])[CH3:14].[F:1][C:2]([F:3])([F:4])[C:5]([OH:6])=[O:7]"
    psmi = "[NH:15]1[CH2:16][CH2:17][CH:18]([CH2:21][O:22][C:23](=[O:24])[CH:25]2[N:26]3[C:27](=[O:38])[N:28]([O:33][S:34](=[O:35])(=[O:36])[OH:37])[CH:29]([CH2:30][CH2:31]2)[CH2:32]3)[CH2:19][CH2:20]1 10-15"

    rsmi = remove_atom_mapping(rsmi)
    psmi = remove_atom_mapping(psmi)
    rxnsmi = rsmi + ">>" + psmi
    # rxnsmi = 'CC(C)(C)OC(=O)N1CCC(N)CC1.CC(C)(C)OC(=O)N1CCC(NC(=O)c2cccc3oc(-c4ccccc4)nc23)CC1>>CC(C)(C)OC(=O)NC1CCN(C(=O)OC(C)(C)C)CC1'
    rxnsmi_am = mapper.evaluate(rxnsmi)

    print(rxnsmi_am)
