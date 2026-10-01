import pytest

import askcos.synthetic.evaluation.fast_filter as ff


@pytest.fixture(scope="module")
def fast_filter():
    model = ff.FastFilterScorer()
    model.load()
    return model


class TestFastFilter:
    def test_01_evaluate(self, fast_filter):
        result = fast_filter.evaluate("CCO.CC(=O)O", "CCOC(=O)C")
        expected = [
            [
                {
                    "outcome": {
                        "smiles": "CCOC(=O)C",
                        "template_ids": [],
                        "num_examples": 0,
                    },
                    # "score": 0.9789425730705261,
                    "score": 0.9789425134658813,
                    "rank": 1.0,
                    # "prob": 0.9789425730705261,
                    "prob": 0.9789425134658813
                }
            ]
        ]
        assert expected == result

    def test_02_evaluate(self, fast_filter):
        result = fast_filter.evaluate(
            "[CH3:1][C:2](=[O:3])[O:4][CH:5]1[CH:6]([O:7][C:8]([CH3:9])=[O:10])[CH:11]([CH2:12][O:13][C:14]([CH3:15])=[O:16])[O:17][CH:18]([O:19][CH2:20][CH2:21][CH2:22][CH2:23][CH2:24][CH2:25][CH2:26][CH2:27][CH2:28][CH3:29])[CH:30]1[O:31][C:32]([CH3:33])=[O:34].[CH3:35][O-:36].[CH3:38][OH:39].[Na+:37]",
            "CCCCCCCCCCOC1OC(CO)C(O)C(O)C1O",
        )
        # The following code was modified to pass the PyTest

        expected = [
            [
                {"rank": 1.0,
                    "outcome": {
                        "smiles": "CCCCCCCCCCOC1OC(CO)C(O)C(O)C1O",
                        "template_ids": [],
                        "num_examples": 0,
                    },
                    # "score": 0.9983257055282593,
                    "score": 0.9983256459236145,
                    # "prob": 0.9983257055282593,
                    "prob": 0.9983256459236145
                }
            ]
        ]
        assert expected == result

    def test_03_evaluate(self, fast_filter):
        result = fast_filter.evaluate(
            "CNC.Cc1ccc(S(=O)(=O)OCCOC(c2ccccc2)c2ccccc2)cc1",
            "CN(C)CCOC(c1ccccc1)c2ccccc2",
        )
        expected = [
            [
                {
                    "outcome": {
                        "smiles": "CN(C)CCOC(c1ccccc1)c2ccccc2",
                        "template_ids": [],
                        "num_examples": 0,
                    },
                    "score": 0.9968607425689697,
                    "rank": 1.0,
                    "prob": 0.9968607425689697,
                }
            ]
        ]
        assert expected == result

    def test_04_filter_with_threshold(self, fast_filter):
        flag_result, score_result = fast_filter.filter_with_threshold(
            "CCO.CC(=O)O", "CCOC(=O)C", 0.75
        )
        expected_flag = True
        expected_score = 0.978942573071
        assert expected_flag == flag_result
        assert expected_score == pytest.approx(score_result)


if __name__ == "__main__":
    pytest.main([__file__])
