import os
import json

import pytest

from askcos.synthetic.evaluation.wln import WLNForwardPredictor
from askcos.utilities.testing import assert_almost_equal


@pytest.fixture(scope="module")
def wln_forward_predictor():
    model = WLNForwardPredictor()
    model.load()
    return model


class TestPredict:
    def test_predict(self, wln_forward_predictor):
        """Test template free forward predictor."""
        smi_am, outcomes = wln_forward_predictor.predict("CCCBr.CCCO")

        assert "[CH3:1][CH2:2][CH2:3][Br:4].[CH3:5][CH2:6][CH2:7][OH:8]" == smi_am

        filepath = os.path.join(os.path.dirname(__file__), "test_data", "outcomes.json")
        if os.path.isfile(filepath):
            with open(filepath, "r") as f:
                expected = json.load(f)

            assert_almost_equal(outcomes, expected)
        else:
            with open(filepath, "w") as f:
                json.dump(outcomes, f)

    def test_predict_atommap(self, wln_forward_predictor):
        """Test template free forward predictor."""
        smi_am, outcomes = wln_forward_predictor.predict("CCCBr.CCCO", atommap=True)

        assert "[CH3:1][CH2:2][CH2:3][Br:4].[CH3:5][CH2:6][CH2:7][OH:8]" == smi_am

        filepath = os.path.join(
            os.path.dirname(__file__), "test_data", "outcomes_am.json"
        )
        if os.path.isfile(filepath):
            with open(filepath, "r") as f:
                expected = json.load(f)

            assert_almost_equal(outcomes, expected)
        else:
            with open(filepath, "w") as f:
                json.dump(outcomes, f)


if __name__ == "__main__":
    pytest.main([__file__])
