"""Declared masses/stoichiometry exercise arithmetic, not scale-up validation."""

from copy import deepcopy

import pytest
from pydantic import ValidationError
from rdkit import Chem
from rdkit.Chem import Descriptors

from packages.chemistry.process_metrics import ProcessInput, calculate_process
from packages.workspace.structure_validation import canonical_structure


def batch():
    return {
        "materials": [
            {"id": "acid", "smiles": "CC(=O)O", "role": "reactant", "mass": {"value": 60.052, "unit": "g"}},
            {"id": "alcohol", "smiles": "CCO", "role": "reactant", "mass": {"value": 0.1, "unit": "kg"}},
            {"id": "water", "smiles": "O", "role": "water", "mass": {"value": 200000, "unit": "mg"}},
        ],
        "product": {"smiles": "CCOC(C)=O", "mass": {"value": 60, "unit": "g"}, "purity_mass_percent": 80, "reported_yield_percent": 55},
        "input_boundary_complete": True,
        "yield_basis": {"limiting_material_id": "acid", "limiting_purity_mass_percent": 100, "reactant_coefficient": 1, "product_coefficient": 1},
    }


def calculate(body):
    return calculate_process(ProcessInput.model_validate(body))


def test_real_molecular_weights_and_separate_bulk_purity_yield_calculations():
    result = calculate(batch())
    assert result.metrics.total_input_mass_g == pytest.approx(360.052)
    assert result.metrics.pmi == pytest.approx(360.052 / 60)
    assert result.product.pure_mass_g == 48
    assert result.metrics.purity_corrected_pmi == pytest.approx(360.052 / 48)
    mw = Descriptors.MolWt(Chem.MolFromSmiles("CCOC(C)=O"))
    assert result.product.theoretical_mass_g == pytest.approx(mw)
    assert result.product.calculated_yield_percent == pytest.approx(48 / mw * 100)
    assert result.product.reported_yield_percent == 55
    assert result.metrics.non_product_mass_difference_g == pytest.approx(300.052)
    assert "e_factor" not in result.model_dump()


@pytest.mark.parametrize("unit,value", [("mg", 100000), ("g", 100), ("kg", 0.1)])
def test_mass_unit_conversion(unit, value):
    body = batch()
    body["materials"][1]["mass"] = {"value": value, "unit": unit}
    assert calculate(body).metrics.pmi == pytest.approx(calculate(batch()).metrics.pmi)


def test_partial_boundary_is_only_a_lower_bound_not_a_full_pmi():
    body = batch()
    body["input_boundary_complete"] = False
    result = calculate(body)
    assert result.metrics.total_input_mass_g is None
    assert result.metrics.pmi is None
    assert result.metrics.pmi_status == "lower_bound"
    assert result.metrics.pmi_lower_bound == pytest.approx(360.052 / 60)
    assert result.metrics.non_product_mass_difference_g is None


def test_missing_mass_is_not_replaced_with_zero_or_asserted_complete():
    body = batch()
    body["materials"][0]["mass"]["value"] = None
    result = calculate(body)
    assert result.materials[0].mass_g is None
    assert result.metrics.known_input_mass_g == 300
    assert result.metrics.total_input_mass_g is None
    assert result.product.calculated_yield_percent is None
    assert result.missing_inputs


@pytest.mark.parametrize("mass,purity", [(0, 80), (60, 0), (None, 80), (60, None)])
def test_zero_and_missing_product_values_do_not_create_fake_ratios(mass, purity):
    body = batch()
    body["product"]["mass"]["value"] = mass
    body["product"]["purity_mass_percent"] = purity
    result = calculate(body)
    if not mass:
        assert result.metrics.pmi is None
        assert result.metrics.pmi_lower_bound is None
    if mass is None or not purity:
        assert result.metrics.purity_corrected_pmi is None
    if mass == 0 and purity:
        assert result.product.calculated_yield_percent == 0


def test_recovery_and_waste_are_recorded_outputs_not_net_pmi_deductions():
    body = batch()
    body["other_outputs"] = [
        {"id": "recovery", "role": "recovered", "smiles": "CCO", "mass": {"value": 90, "unit": "g"}},
        {"id": "waste", "role": "waste", "mass": {"value": 200, "unit": "g"}},
    ]
    result = calculate(body)
    assert result.metrics.pmi == pytest.approx(360.052 / 60)
    assert result.metrics.unaccounted_mass_g == pytest.approx(10.052)
    assert result.metrics.recorded_mass_recovery_percent == pytest.approx(350 / 360.052 * 100)
    assert result.other_outputs[1].structure is None


def test_unknown_output_mass_prevents_mass_closure_but_not_pmi():
    body = batch()
    body["other_outputs"] = [{"id": "waste", "role": "waste", "mass": {"value": None, "unit": "g"}}]
    result = calculate(body)
    assert result.metrics.unaccounted_mass_g is None
    assert result.metrics.pmi is not None


def test_impossible_complete_mass_balance_is_rejected_but_partial_is_not_invented():
    body = batch()
    body["product"]["mass"]["value"] = 500
    with pytest.raises(ValueError, match="超过总投料"):
        calculate(body)
    body["input_boundary_complete"] = False
    assert calculate(body).metrics.pmi is None


def test_declared_stoichiometry_not_an_automatic_limiting_reagent_decision():
    body = batch()
    body["yield_basis"]["product_coefficient"] = 2
    result = calculate(body)
    assert result.product.theoretical_mass_g == pytest.approx(calculate(batch()).product.theoretical_mass_g * 2)
    body["yield_basis"] = None
    assert calculate(body).product.calculated_yield_percent is None


@pytest.mark.parametrize("smiles", ["[Na+].CC(=O)[O-]", "N[C@@H](C)C(=O)O", "[13CH3]CO", "F/C=C/F"])
def test_process_preserves_salts_stereochemistry_and_isotopes(smiles):
    body = batch()
    body["materials"][0]["smiles"] = smiles
    body["product"]["smiles"] = smiles
    result = calculate(body)
    assert result.materials[0].structure.smiles == canonical_structure(smiles)[0]
    assert result.product.structure.smiles == canonical_structure(smiles)[0]
    assert result.materials[0].structure.molecular_weight_g_mol == pytest.approx(Descriptors.MolWt(Chem.MolFromSmiles(smiles)))


@pytest.mark.parametrize("value", [-1, float("inf"), float("nan"), True, "1", 1e10])
def test_invalid_mass_numbers_are_rejected(value):
    body = batch()
    body["materials"][0]["mass"]["value"] = value
    with pytest.raises(ValidationError):
        ProcessInput.model_validate(body)


def test_zero_theoretical_mass_and_yield_above_100_are_explicit():
    body = batch()
    body["yield_basis"]["limiting_purity_mass_percent"] = 0
    result = calculate(body)
    assert result.product.theoretical_mass_g == 0
    assert result.product.calculated_yield_percent is None
    body["yield_basis"]["limiting_purity_mass_percent"] = 1
    assert any("超过 100%" in text for text in calculate(body).notices)


def test_unique_ids_bounded_rows_and_reactant_only_yield_basis():
    for mutate in [
        lambda b: b["materials"].append(deepcopy(b["materials"][0])),
        lambda b: b["yield_basis"].update(limiting_material_id="water"),
        lambda b: b["materials"][0]["mass"].update(unit="mL"),
        lambda b: b["product"].update(purity_mass_percent=101),
        lambda b: b["yield_basis"].update(reactant_coefficient=0),
        lambda b: b.update(materials=[]),
    ]:
        body = batch()
        mutate(body)
        with pytest.raises(ValidationError):
            ProcessInput.model_validate(body)
    body = batch()
    body["materials"] = [{**deepcopy(body["materials"][0]), "id": f"r{i}"} for i in range(51)]
    with pytest.raises(ValidationError):
        ProcessInput.model_validate(body)


def test_request_atom_budget_is_enforced_for_combined_structures():
    body = batch()
    with pytest.raises(ValueError):
        calculate_process(ProcessInput.model_validate(body), max_atoms=2)
    body["yield_basis"] = None
    body["materials"] = [{"id": f"r{i}", "role": "solvent", "smiles": "C" * 100, "mass": {"value": 1, "unit": "g"}} for i in range(42)]
    with pytest.raises(ValueError, match="总结构原子数"):
        calculate(body)


def test_missing_other_output_cannot_bypass_product_mass_balance_validation():
    body = batch()
    body["product"]["mass"]["value"] = 500
    body["other_outputs"] = [{"id": "w", "role": "waste", "mass": {"value": None, "unit": "g"}}]
    with pytest.raises(ValueError, match="超过总投料"):
        calculate(body)
