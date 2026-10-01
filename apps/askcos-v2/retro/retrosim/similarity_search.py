import numpy as np
import os
from api.reaction_api import ReactionsAPI
from reaction_record import get_reaction_smarts
from rdchiral.initialization import rdchiralReaction, rdchiralReactants
from rdchiral.main import rdchiralRun
# from rdchiral.template_extractor import extract_from_reaction
from rdkit import Chem, DataStructs
from rdkit.Chem import AllChem
from typing import List, Tuple

GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://0.0.0.0:9100")
reaction_api = ReactionsAPI(
    default_url=f"{GATEWAY_URL}/api/reactions"
)


class SimilaritySearch:
    def __init__(self):
        self.reaction_api = reaction_api
        self.fp_packed = {
            "USPTO_FULL": np.load("./data/USPTO_FULL.fp_packed.npy"),
            "bkms": np.load("./data/bkms_metabolic.fp_packed.npy")
        }
        self.fp_counts = {
            "USPTO_FULL": np.load("./data/USPTO_FULL.fp_counts.npy"),
            "bkms": np.load("./data/bkms_metabolic.fp_counts.npy")
        }
        self.ids = {}
        with open("./data/USPTO_FULL.ids.txt", "r") as f:
            lines = f.readlines()
        self.ids["USPTO_FULL"] = [line.strip() for line in lines]
        with open("./data/bkms_metabolic.ids.txt", "r") as f:
            lines = f.readlines()
        self.ids["bkms"] = [line.strip() for line in lines]

        self.bits_per_byte = np.zeros(256, dtype=np.uint8)
        i = 1
        while i < 256:
            self.bits_per_byte[i:i*2] = self.bits_per_byte[: i] + 1
            i += i

    @staticmethod
    def getfp(smi: str):
        fp = AllChem.GetMorganFingerprint(Chem.MolFromSmiles(smi), 2, useFeatures=True)

        return fp

    def lookup_similar_smiles_fast(
        self,
        smiles: str,
        threshold: float,
        top_k: int,
        reaction_set: str
    ) -> Tuple[np.ndarray, List[str]]:
        fp_packed = self.fp_packed[reaction_set]
        fp_counts = self.fp_counts[reaction_set]
        ids = self.ids[reaction_set]

        fp_size = 2048
        fp_radius = 2

        # SMILES to packed fingerprint
        target_mol = AllChem.RemoveHs(Chem.MolFromSmiles(smiles))
        qfp_bits_vc = AllChem.GetMorganFingerprintAsBitVect(
            target_mol, radius=fp_radius, nBits=fp_size)
        qfp_bits = np.empty((1, fp_size), dtype=np.int32)
        DataStructs.ConvertToNumpyArray(qfp_bits_vc, qfp_bits)
        qfp_bits = qfp_bits.astype(dtype=np.bool_)
        qfp_packed = np.packbits(qfp_bits)

        # tanimoto
        intersection_bits = np.bitwise_and(fp_packed, qfp_packed)
        intersection_counts = np.sum(self.bits_per_byte[intersection_bits], axis=1)

        qfp_count = np.count_nonzero(qfp_bits)
        union_counts = fp_counts + qfp_count - intersection_counts

        tanimoto = intersection_counts / union_counts

        # top_100 (to be conservative since some might not have valid SMARTS)
        ind = np.argpartition(tanimoto, -100)[-100:]      # UNSORTED

        sim_prods = tanimoto[ind]
        top_reactions_ids = [ids[i] for i in ind]

        return sim_prods, top_reactions_ids

    def find_similar_retrosim(
        self,
        target_product_smiles: str,
        threshold: float = 0.3,
        top_k: int = 10,
        reaction_set: str = "USPTO_FULL",
        method: str = "accurate"
    ) -> list:
        """
        Finds top_k reactions in the reactions collection that generate products similar to
        the given SMILES string. Returns the predicted precursors for each reaction and 
        the similarity score.

        :param target_product_smiles: A SMILES string.
        :param threshold: A float that specifies the similarity threshold.
        :param top_k: An integer specifying how many products' templates
            in database are used to give precursors.
        :param reaction_set: A string specifying the reaction set.
        :param method: A string specifying the method for similarity search.
        """
        # similar_products = self.reaction_api.lookup_similar_smiles(
        #     smiles=target_product_smiles,
        #     threshold=threshold,
        #     top_k=top_k,
        #     reaction_set=reaction_set,
        #     method=method
        # )
        sim_prods, top_reactions_ids = self.lookup_similar_smiles_fast(
            smiles=target_product_smiles,
            threshold=threshold,
            top_k=top_k,
            reaction_set=reaction_set
        )

        # if not sim_prods:
        #     return []
        # k = min(top_k, len(similar_products))
        # top_reactions_ids = [i['id'] for i in similar_products[:k]]
        top_reactions = [
            self.reaction_api.search_id(id=i, reaction_set=reaction_set)
            for i in top_reactions_ids
        ]
        # top_reactions_templates = [extract_from_reaction(r) for r in top_reactions]

        sim = DataStructs.BulkTanimotoSimilarity

        precursors = []
        for i, rxn in enumerate(top_reactions):
            template = get_reaction_smarts(rxn)
            if not template:
                continue

            template = f"({template.replace('>>', ')>>')}"
            retro_reaction = rdchiralReaction(template)
            product = rdchiralReactants(target_product_smiles)

            try:
                outcomes = rdchiralRun(retro_reaction, product, combine_enantiomers=True)
            except Exception as e:
                print(e)
                outcomes = []

            if not outcomes:
                continue

            new_outcomes = []
            for target_reactant in outcomes:
                fp_target_reactant = self.getfp(target_reactant)
                fp_lookup_reactant = self.getfp(rxn["reaction_smiles"].split(">")[0])
                sim_score = sim(fp_lookup_reactant, [fp_target_reactant])[0]
                new_outcomes.append((sim_score, target_reactant))

            # record tpl_idx as well for proper indexing below, as some iterations are skipped
            precursors.append((i, new_outcomes))

        output = []
        precursors_set = set()
        for i, precs_list in precursors:
            sim_prod = sim_prods[i]
            reaction_id = top_reactions_ids[i]
            reaction_data = {"reaction_smiles": top_reactions[i]["reaction_smiles"]}

            if "reference_url" in top_reactions[i]:
                reaction_data["reference_url"] = top_reactions[i]["reference_url"]
            if "patent_number" in top_reactions[i]:
                reaction_data["patent_number"] = top_reactions[i]["patent_number"]

            for (sim_precs, prec) in precs_list:
                if prec in precursors_set:
                    continue
                sim = sim_prod * sim_precs
                output.append((sim, prec, reaction_id, reaction_data))
                precursors_set.add(prec)

        output = sorted(output, key=lambda x: x[0], reverse=True)
        output = [o for o in output if o[0] >= threshold]
        output = output[:top_k]

        return output


if __name__ == '__main__':
    searcher = SimilaritySearch()
    # print(searcher.find_similar_retrosim("O=C/C=C/C1=CC=COC1O", threshold=0.3, top_k=10))
    print(searcher.find_similar_retrosim("NC1CCCN(C2CCCC(O)C2)C1", threshold=0.1, top_k=20))
    # print(searcher.find_similar_retrosim(
    #     "O:1]=[CH:2]/[CH:3]=[CH:4]/[C:5]1=[CH:8][CH:9]=[C:10]([C:12](=[O:13])[OH:14])[O:11][CH:6]1[OH:7]",
    #     threshold=0.3,
    #     top_k=10
    # ))
