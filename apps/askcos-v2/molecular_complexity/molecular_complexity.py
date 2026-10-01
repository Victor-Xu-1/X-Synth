import os
import numpy as np

import networkx as nx
from rdkit import Chem
from rdkit.Chem.AtomPairs import Pairs,Torsions
from rdkit.Chem import Descriptors, GraphDescriptors
from openbabel import openbabel
openbabel.obErrorLog.SetOutputLevel(0)
import pkg_resources

# external complexity metrics
from molcomplex.metrics.sa_score import SAScorer
from molcomplex.metrics.boettcher import BottchScorer
from molcomplex.metrics.proudfoot import ProudfootIndexCalculator
from molcomplex.metrics.rucker_twc import TWCCalculator
from molcomplex.metrics.sps_score import SpacialScorer


from api.scscorer_api import SCScorerAPI
GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://0.0.0.0:9100")
scscorer = SCScorerAPI(
    default_url=f"{GATEWAY_URL}/api/scscore/call-sync"
)


class MolComplex:

    def __init__(self):

        self.comp_to_f = {
            "balan": self.get_balaban_score,
            "bertz": self.get_bertz_score,
            "boettcher": self.get_boettcher_score,
            "hallkieralpha": self.get_hallkieralpha_score,
            "ipc": self.get_ipc_score,
            "proudfoot": self.get_proudfoot_index,
            "sascore": self.get_sascore,
            "scscore": self.get_scscore,
            "spatial": self.get_spatial_score,
            "twc": self.get_rucker_twc,
        }

        self.proudfoot = ProudfootIndexCalculator()
        self.scscorer = scscorer
        self.sps_scorer = SpacialScorer()
        self.rucker_twc = TWCCalculator()
        self.init_boettcher()
        self.init_sa_scorer()

    def init_boettcher(self):
        self.obConversion = openbabel.OBConversion()
        self.obConversion.SetInAndOutFormats("smi", "smi")
        self.bottch = BottchScorer("False")

    def init_sa_scorer(self):
        self.sa_scorer = SAScorer()

    def get_complexity_from_smiles(self, smi, complexity_metrics=[]):

        smis = smi.split('.')
        mols = [Chem.MolFromSmiles(s) for s in smis]

        molcomplex_dict = {"smiles": smi}

        metrics_not_allowed = [
            comp for comp in complexity_metrics
            if comp not in self.comp_to_f
        ]

        if metrics_not_allowed:
            raise ValueError(
                f"Complexity metrics not allowed: {metrics_not_allowed} \n"
                f"Allowed metrics: {list(self.comp_to_f.keys())}"
            )

        for comp in complexity_metrics:
            if comp in self.comp_to_f:
                molcomplex_dict[comp] = self.comp_to_f[comp](smis, mols)

        return molcomplex_dict

    def get_batch_complexity(self, smiles_list, complexity_metrics=[]):
        """
        Batch process a list of SMILES strings and return a list of complexity metric results.
        Each result is a dict as returned by get_complexity_from_smiles.
        """
        results = []
        for smi in smiles_list:
            result = self.get_complexity_from_smiles(smi, complexity_metrics)
            results.append(result)
        return results

    # Balaban J Score (Chem. Phys. Lett. 1982, 89, 399-404
    def get_balaban_score(self, smis, mols):
        score = 0
        for mol in mols:
            try:
                score += GraphDescriptors.BalabanJ(mol)
            except:
                pass

        return score

    def get_bertz_score(self, smis, mols):
        score = 0
        for mol in mols:
            try:
                score += GraphDescriptors.BertzCT(mol)
            except:
                pass

        return score

    # Boettcher Score (J. Chem. Inf. Model. 2016, 56, 3, 462–470)
    def get_boettcher_score(self, smis, mols):

        score = 0
        for i, smi in enumerate(smis):
            try:
                obmol = openbabel.OBMol()
                self.obConversion.ReadString(obmol, smi)
                score += self.bottch.score(obmol)
            except:
                pass

        return score


    # Kier's alpha-modified shape indices
    def get_hallkieralpha_score(self, smis, mols):
        score = 0
        for mol in mols:
            try:
                score += GraphDescriptors.HallKierAlpha(mol)
            except:
                pass

        return score


    #  Bonchev & Trinajstic's information content of the coefficients of the characteristic
    # polynomial of the adjacency matrix of a hydrogen-suppressed graph of a molecule (J. Chem. Phys. 1977, 67, 4517-4533)
    def get_ipc_score(self, smis, mols):
        score = 0
        for mol in mols:
            try:
                score += GraphDescriptors.Ipc(mol)
            except:
                pass

        return score

    # Proudfoot's Cm index based on atom environments (Bioorganic Med. Chem. Lett. 2017, 27, 2014–2017)
    def get_proudfoot_index(self, smis, mols):

        score = 0
        for i, mol in enumerate(mols):
            try:
                score += self.proudfoot.proudfoot_index(mol)[0]
            except:
                pass
        return score

    # Ertl SA_Score (J. Cheminform. 2009, 1, 8)
    def get_sascore(self, smis, mols):
        score = 0

        for mol in mols:
            try:
                score += self.sa_scorer.calculateScore(mol)
            except:
                pass

        return score

    #  SCScore (J. Chem. Inf. Model. 2018, 58, 2, 252)
    def get_scscore(self, smis, mols):


        scscore = 0
        for i, smi in enumerate(smis):

            try:
                score = self.scscorer(smiles=smi)
                scscore += score
            except:
                pass
        return scscore

    # Spatial score based on https://doi.org/10.1021/acs.jmedchem.3c00689.
    def get_spatial_score(self, smis, mols):
        score = 0
        for smi in smis:
            try:
                score += self.sps_scorer.calculate_score_from_smiles(smi)
            except:
                pass

        return score

    # Rücker's total walk count (twc) index (J. Chem. Inf. Comput. Sci. 1993, 33, 683-695)
    def get_rucker_twc(self, smis, mols):

        score = 0
        for i, mol in enumerate(mols):
            try:
                score += self.rucker_twc.twc(mol)
            except:
                pass
        return score