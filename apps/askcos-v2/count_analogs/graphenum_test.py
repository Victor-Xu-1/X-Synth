import pytest
from askcos.utilities.buyable.file_pricer import FilePricer
from askcos.synthetic.library import RxnGraphEnumerator
from askcos.synthetic.atom_mapper.wln_mapper import WLNAtomMapper


class TestRxnGraphEnumerator:
    def setup_method(self):
        self.pricer = FilePricer()
        self.pricer.load(
            path="askcos/synthetic/library/buyables_test.json.gz", precompute_mols=True
        )
        self.mapper = WLNAtomMapper()

    def test_diphenhydramine_unmapped_1(self):
        reaction_smiles = [
            "BrC(c1ccccc1)c2ccccc2.CN(CCO)C>>CN(CCOC(c3ccccc3)c4ccccc4)C"
        ]
        graph = RxnGraphEnumerator(reaction_smiles, mapper=self.mapper)
        graph.search_building_blocks(self.pricer)

        combos = graph.count_combinations()
        library = set([d["smiles"] for d in graph.library_generator()])
        expected = set(
            [
                "CN(C)CCCOC(c1ccccc1)c1ccccc1",
                "CN(C)CCCOC(c1ccc(O)cc1)c1ccc(O)cc1",
                "CN(C)CCOC(c1ccccc1)c1ccccc1",
                "CN(C)CCOC(c1ccc(O)cc1)c1ccc(O)cc1",
                "CC(COC(c1ccccc1)c1ccccc1)N(C)C",
                "CC(COC(c1ccc(O)cc1)c1ccc(O)cc1)N(C)C",
                "c1ccc(C(OC(c2ccccc2)c2ccccc2)c2ccccc2)cc1",
                "Oc1ccc(C(OC(c2ccc(F)cc2)c2ccc(F)cc2)c2ccc(O)cc2)cc1",
                "Fc1ccc(C(OC(c2ccccc2)c2ccccc2)c2ccc(F)cc2)cc1",
                "Oc1ccc(C(OC(c2ccccc2)c2ccccc2)c2ccc(O)cc2)cc1",
            ]
        )

        assert library == expected
        assert combos == 10
        assert len(library) == combos

        graph.filter_by_similarity(threshold=0.3)
        graph.filter_by_plausibility(threshold=0.1)

        filtered_combos = graph.count_combinations()
        filtered_library = set([d["smiles"] for d in graph.library_generator()])
        assert filtered_combos <= combos
        assert len(filtered_library) == filtered_combos

    def test_diphenhydramine_unmapped_2(self):
        reaction_smiles = [
            "BrCCOC(c1ccccc1)c1ccccc1.CNC>>CN(C)CCOC(c1ccccc1)c1ccccc1",
            "BrCCBr.OC(c1ccccc1)c1ccccc1>>BrCCOC(c1ccccc1)c1ccccc1",
        ]
        graph = RxnGraphEnumerator(reaction_smiles, mapper=self.mapper)
        graph.search_building_blocks(self.pricer)
        graph.filter_by_similarity(threshold=0.41)

        combos = graph.count_combinations()
        library = set([d["smiles"] for d in graph.library_generator()])
        expected = set(
            ["CN(C)CCOC(c1ccc(F)cc1)c1ccc(F)cc1", "CN(C)CCOC(c1ccccc1)c1ccccc1"]
        )

        assert library == expected
        assert combos == 2
        assert len(library) == combos

        graph.filter_by_similarity(threshold=0.3)
        graph.filter_by_plausibility(threshold=0.1)

        filtered_combos = graph.count_combinations()
        filtered_library = set([d["smiles"] for d in graph.library_generator()])
        assert filtered_combos <= combos
        assert len(filtered_library) == filtered_combos

    def test_diphenhydramine_protection_1(self):
        reaction_smiles = [
            "[Br:1][CH2:2][CH2:3][Br:18].[OH:4][CH:5]([c:6]1[cH:7][cH:8][cH:9][cH:10][cH:11]1)[c:12]1[cH:13][cH:14][cH:15][cH:16][cH:17]1>>[Br:1][CH2:2][CH2:3][O:4][CH:5]([c:6]1[cH:7][cH:8][cH:9][cH:10][cH:11]1)[c:12]1[cH:13][cH:14][cH:15][cH:16][cH:17]1",
            "[Br:1][CH2:2][CH2:3][O:4][CH:5]([c:6]1[cH:7][cH:8][cH:9][cH:10][cH:11]1)[c:12]1[cH:13][cH:14][cH:15][cH:16][cH:17]1.[OH:18][c:19]1[cH:20][cH:21][cH:22][cH:23][cH:24]1>>[CH2:2]([CH2:3][O:4][CH:5]([c:6]1[cH:7][cH:8][cH:9][cH:10][cH:11]1)[c:12]1[cH:13][cH:14][cH:15][cH:16][cH:17]1)[O:18][c:19]1[cH:20][cH:21][cH:22][cH:23][cH:24]1",
            "[CH3:1][NH:2][CH3:3].[cH:4]1[cH:5][cH:6][c:7]([O:8][CH2:9][CH2:10][O:11][CH:12]([c:13]2[cH:14][cH:15][cH:16][cH:17][cH:18]2)[c:19]2[cH:20][cH:21][cH:22][cH:23][cH:24]2)[cH:25][cH:26]1>>[CH3:1][N:2]([CH3:3])[CH2:9][CH2:10][O:11][CH:12]([c:13]1[cH:14][cH:15][cH:16][cH:17][cH:18]1)[c:19]1[cH:20][cH:21][cH:22][cH:23][cH:24]1",
        ]
        graph = RxnGraphEnumerator(reaction_smiles, mapper=self.mapper)
        graph.search_building_blocks(self.pricer)
        graph.filter_by_similarity(threshold=0.21)

        all_combos = graph.count_combinations(deduplicate=False)
        deduped_combos = graph.count_combinations()
        library = set(
            [d["smiles"] for d in graph.library_generator() if len(d["smiles"])]
        )
        expected = set(
            ["CN(C)CCOC(c1ccc(F)cc1)c1ccc(F)cc1", "CN(C)CCOC(c1ccccc1)c1ccccc1"]
        )

        assert all_combos == 10
        assert deduped_combos == 2
        assert library == expected

    def test_diphenhydramine_parallel_5(self):
        reaction_smiles = [
            "BrC(c1ccccc1)c2ccccc2.CN(CCO)C>>CN(CCOC(c3ccccc3)c4ccccc4)C"
        ]
        graph = RxnGraphEnumerator(reaction_smiles, mapper=self.mapper)
        graph.search_building_blocks(self.pricer)

        combos = graph.count_combinations()

        result = graph.generate_library(nproc=8)
        assert combos == len(result)


if __name__ == "__main__":
    pytest.main([__file__])
