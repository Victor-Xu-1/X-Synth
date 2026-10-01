import pytest

from askcos.synthetic.reaction_classification.reaction_class import ReactionClass


@pytest.fixture(scope="module")
def reaction_classifier():
    model = ReactionClass()
    model.load_model()
    return model


class TestReactionClassification:
    @pytest.mark.parametrize(
        "smiles,target_class_name,target_class_nums",
        [
            ("CC=CC>>CCCC", "hydrogenation", ["7.6.1"]),
            ("ClCCC>>C=CC", "SN2 elimination", ["9.7.254"]),
            ("CC=CC>>CC(O)C(C)O", "dihydroxylation", ["10.4.9", "10.4.11"]),
            (
                "CCC(C)O>>CCC(C)=O",
                "oxidation",
                ["8.1.5", "8.1.3", "8.1.10", "8.1.7", "8.1.15"],
            ),
            ("CCC(C)=O>>CCC(C)O", "reduction", ["7.5.1", "7.5.2", "7.5.5"]),
            (
                "CC(O)CCCCC(O)CC>>CC(=O)CCCCC(=O)CC",
                "oxidation",
                ["8.1.5", "8.1.3", "8.1.10", "8.1.7", "8.1.15"],
            ),
            ("CC=CC>>CC=O", "ozonolysis", ["8.5.1", "8.5.2"]),
            ("CCO.CCBr>>CCOCC.Br", "williamson ether", ["1.7.9"]),
            ("CC=CC>>CC(O)CC", "hydration", ["10.4.3"]),
            ("CC=CC>>CC(Br)CC", "hydrohalogenation", ["10.1.8"]),
            ("CC=CC>>CC(Br)C(Br)C", "dihalogenation", ["10.1.6"]),
            ("COC=CC=C.C=CC#N>>COC1C=CCCC1(C#N)", "diels alder", ["3.11.3"]),
            ("c1ccccc1.CC(=O)Cl>>c1ccccc1C(=O)C.Cl", "freidel crafts", ["3.10.1"]),
            ("CC(=O)N=[N+]=N>>CNC(=O)OC", "curtius rearrangement", ["2.4.1"]),
            # ("CCOC(=O)c1ccccc1.CC(=O)c1ccccc1>>O=C(CC(=O)c1ccccc1)c1ccccc1.CCO", "clasisen condensation", ["3.11.41"]),
            ("CCCCl>>C=CC", "SN2 elimination", ["9.7.254"]),
            ("CC#CC>>CC=CC", "alkyne hydrogenation 1", ["7.9.8"]),
            (r"CC#CC>>C/C=C\C", "alkyne hydrogenation 2", ["7.9.8"]),
            (
                "CC=C(C)C>>CC(C)C(C)C=O",
                "hydroformylation",
                ["8.7.4", "3.9.34", "10.4.1"],
            ),
            ("C[C-](C)[N+](=O)[O-]>>CC(C)=O", "nef", ["9.7.89"]),
            ("C=[N+]=[N-].CC=CC>>C1CC1", "cyclopropanation", ["3.11.57"]),
            (
                "O=C(O)C1CCCCC1.C[N+]#N>>COC(=O)C1CCCCC1.N#N",
                "diazomethane methylesterification",
                ["1.7.2", "1.7.6"],
            ),
            ("CC(C)CC=O.CC[Mg]Br>>CCC(O)CC(C)C", "bromo grignard", ["3.7.2"]),
            ("CC(=O)CC(C)C.CC[Mg]Br>>CCC(C)(O)CC(C)C", "bromo grignard 2", ["3.7.2"]),
            ("O=C1CCCC1>>O=C1OCCCC1", "baeyer villager", ["2.6.4"]),
            ("COc1ccccc1>>COC1=CCC=CC1", "birch reduction", ["7.9.15"]),
            (
                "CCc1ccc(Cl)cc1.Nc1ccccc1>>CCc2ccc(Nc1ccccc1)cc2",
                "buchwald-hartwig",
                ["1.3.2", "1.3.7"],
            ),
            ("CC(=O)c1ccccc1>>CCc1ccccc1", "clemmensen reduction", ["7.9.4", "7.9.6"]),
            (
                "CC(=O)c1ccccc1>>OC(=O)c1ccccc1",
                "haloform reaction",
                ["9.7.240", "9.7.241"],
            ),
            ("O=C(O)Cc1ccccc1>>O=C(O)C(Br)c1ccccc1", "HVZ bromination", ["10.1.1"]),
            ("NC(=O)c1ccccc1>>Nc1ccccc1", "hoffman rearrangement", ["9.7.70"]),
            (
                "CCOC(=O)CC(=O)OCC.CCC(C)=O>>CCC(C)=CC(=O)O",
                "knovengal condensation",
                ["3.11.34"],
            ),
            ("C=O.CNC.CCC(=O)CC>>CCC(=O)C(C)CN(C)C", "mannich", ["3.11.6"]),
            (
                "CC(=O)CC(C)=O.C=CC(=O)OCC>>CCOC(=O)CCC(C(C)=O)C(C)=O",
                "michael addition",
                ["3.11.76"],
            ),
            (
                "CC(O)C.OC(=O)CC>>CC(OC(=O)CC)C",
                "esterification",
                ["2.6.2", "2.6.9", "2.6.3"],
            ),
            (
                "CN(C)c1ccccc1.O=CN(C)C>>CN(C)c1ccc(C=O)cc1",
                "vilsimer-haack/formylation",
                ["3.11.14", "10.4.1"],
            ),
        ],
    )
    def test_reaction_class(
        self, smiles, target_class_name, target_class_nums, reaction_classifier
    ):
        """Test reaction classification model"""
        results = reaction_classifier.get_classes(smiles, num_results=10)["result"]
        class_nums = [res["reaction_num"] for res in results]
        assert any(num in target_class_nums for num in class_nums)


if __name__ == "__main__":
    pytest.main([__file__])


import pytest
import requests


def test_call():
    url = "http://0.0.0.0:9603/reaction_class"
    data = {
        "smiles": [
            "CC(O)CCCCC(O)CC>>CC(=O)CCCCC(=O)CC"
        ]
    }
    resp = requests.post(url, json=data)

    assert resp.status_code == 200
    resp = resp.json()
    assert resp["status"] == "SUCCESS"
    result = resp["results"][0]
    # assert len(result) == 123
    # assert type(result[0]) == dict
    # assert len(result[0].get("atom_scores")) == 7


if __name__ == "__main__":
    pytest.main([__file__])