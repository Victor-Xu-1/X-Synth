import os
from api.reaction_api import ReactionsAPI

GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://0.0.0.0:9100")
reaction_api = ReactionsAPI(
    default_url=f"{GATEWAY_URL}/api/reactions"
)


class ExactMatch:
    def __init__(self):
        self.reaction_api = reaction_api

    def search_exact(
        self,
        target_product_smiles: str,
        reaction_set: str = "USPTO_FULL"
    ) -> list:
        """
        Finds reactions in the reactions collection that generate the product.
        Returns the recorded precursors for each reaction.

        :param target_product_smiles: A SMILES string.
        :param reaction_set: A string specifying the reaction set.
        """
        reactions_ids = self.reaction_api.lookup_by_exact_product_smiles(
            smiles=target_product_smiles,
            reaction_set=reaction_set
        )

        reactions = [
            self.reaction_api.search_id(id=i, reaction_set=reaction_set)
            for i in reactions_ids
        ]

        output = []
        for rxn in reactions:
            precursor = rxn["reaction_smiles"].split(">")[0]
            reaction_id = str(rxn["_id"])
            reaction_data = {"reaction_smiles": rxn["reaction_smiles"]}

            if "reference_url" in rxn:
                reaction_data["reference_url"] = rxn["reference_url"]
            if "patent_number" in rxn:
                reaction_data["patent_number"] = rxn["patent_number"]

            output.append((precursor, reaction_id, reaction_data))

        return output


if __name__ == '__main__':
    searcher = ExactMatch()
    print(searcher.search_exact(
        "NC1CCCN(C2CCCC(O)C2)C1",
        reaction_set="USPTO_FULL"
    ))
