import pytest

from askcos.synthetic.selectivity.general_selectivity import (
    QmGnnGeneralSelectivityPredictor,
    QmGnnGeneralSelectivityPredictorNoReagent,
    GnnGeneralSelectivityPredictor,
)


class TestGeneralSelectivity:
    def test_qm_gnn_predictor_reagents(self):
        """Test qm_gnn predictor"""
        rxn = "CC(COc1n[nH]cc1)C.CC(C)(OC(c1c(Cl)nc(Cl)cc1)=O)C>CN(C=O)C.O>CC(OC(c1ccc(n2ccc(OCC(C)C)n2)nc1Cl)=O)(C)C"
        predictor = QmGnnGeneralSelectivityPredictor()

        res = predictor.predict(rxn)
        assert len(res) == 2
        assert type(res[0]) == dict
        assert res[0]["prob"] == pytest.approx(1, 2)

    def test_qm_gnn_predictor_no_reagents(self):
        """Test qm_gnn predictor"""
        rxn = "CC(COc1n[nH]cc1)C.CC(C)(OC(c1c(Cl)nc(Cl)cc1)=O)C>>CC(OC(c1ccc(n2ccc(OCC(C)C)n2)nc1Cl)=O)(C)C"
        predictor = QmGnnGeneralSelectivityPredictorNoReagent()

        res = predictor.predict(rxn)
        assert len(res) == 2
        assert type(res[0]) == dict
        assert res[0]["prob"] == pytest.approx(1, 2)

    def test_gnn_predictor(self):
        """Test qm_gnn predictor"""
        rxn = "CC(COc1n[nH]cc1)C.CC(C)(OC(c1c(Cl)nc(Cl)cc1)=O)C>>CC(OC(c1ccc(n2ccc(OCC(C)C)n2)nc1Cl)=O)(C)C"
        predictor = GnnGeneralSelectivityPredictor()

        res = predictor.predict(rxn)
        assert len(res) == 2
        assert type(res[0]) == dict
        assert res[0]["prob"] == pytest.approx(1, 2)


if __name__ == "__main__":
    pytest.main([__file__])
