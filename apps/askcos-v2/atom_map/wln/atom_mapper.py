from template_free import TemplateFreeNeuralNetScorer as TFFP_AM
from rdkit import Chem


class atom_mapper:
    def __init__(self):
        self.predictor = TFFP_AM()

    def find_atom_map(self, smi: str):
        rsmi, psmi = smi.split(">>")
        rsmi = self.MolToSmiles_no_am(rsmi)
        psmi = self.MolToSmiles_no_am(psmi)

        rsmi_am, outcomes = self.predictor.evaluate(rsmi)
        psmi_canonical = Chem.MolToSmiles(Chem.MolFromSmiles(psmi), isomericSmiles=False)
        psmi_am = ''
        for outcome in outcomes[0]:
            if outcome['outcome']['smiles'] == psmi_canonical:
                psmi_am = outcome['outcome']['smiles_w_am']

        if not psmi_am:
            print('Failed to find the atom mapping.')
            return ""
        mapped_smi = f"{rsmi_am}>>{psmi_am}"

        return mapped_smi

    @staticmethod
    def MolToSmiles_no_am(smi_am):
        mol = Chem.MolFromSmiles(smi_am)
        for atom in mol.GetAtoms():
            # get rid of clearing atom mapping function, so the output will have atom maps
            atom.ClearProp('molAtomMapNumber')
        return Chem.MolToSmiles(mol)


if __name__ == '__main__':
    mapper = atom_mapper()

    rsmi = '[C:8]([O:9][C:10](=[O:11])[N:15]1[CH2:16][CH2:17][CH:18]([CH2:21][O:22][C:23](=[O:24])[CH:25]2[N:26]3[C:27](=[O:38])[N:28]([O:33][S:34](=[O:35])(=[O:36])[OH:37])[CH:29]([CH2:30][CH2:31]2)[CH2:32]3)[CH2:19][CH2:20]1)([CH3:12])([CH3:13])[CH3:14].[F:1][C:2]([F:3])([F:4])[C:5]([OH:6])=[O:7]'
    psmi = '[NH:15]1[CH2:16][CH2:17][CH:18]([CH2:21][O:22][C:23](=[O:24])[CH:25]2[N:26]3[C:27](=[O:38])[N:28]([O:33][S:34](=[O:35])(=[O:36])[OH:37])[CH:29]([CH2:30][CH2:31]2)[CH2:32]3)[CH2:19][CH2:20]1 10-15'
    rsmi_am, psmi_am = mapper.find_atom_map(mapper.MolToSmiles_no_am(rsmi), mapper.MolToSmiles_no_am(psmi))
