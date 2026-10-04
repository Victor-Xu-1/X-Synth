"""Typed requests and strict mapped-atom contracts; not assay validation."""

import pytest
from pydantic import ValidationError

from packages.adapters.askcos.impurities import ImpurityInput, canonical_input, validate_mapping


def body(**changes):
    return {"reactants": ["CC(=O)Cl", "CN"], "known_product": "CNC(C)=O", **changes}


@pytest.mark.parametrize("changes", [
    {"reactants": []}, {"reactants": ["C"] * 5}, {"count": 0}, {"count": 11},
    {"count": True}, {"check_mapping": False}, {"record_id": "a" * 32},
    {"reagents": ["O"] * 3}, {"solvents": ["O"] * 3}, {"known_product": ""},
])
def test_input_schema_is_bounded_and_mapping_cannot_be_disabled(changes):
    with pytest.raises(ValidationError):
        ImpurityInput.model_validate(body(**changes))


@pytest.mark.parametrize("value", ["*", "CCO label", "[CH3:1]O", "C" * 81, "C[C@H](F)Cl |&1:1|"])
def test_strict_parser_and_atom_mapping_authority(value):
    with pytest.raises(ValueError):
        canonical_input(ImpurityInput.model_validate(body(reactants=[value])))


def test_full_records_preserve_salts_isotopes_stereo_and_declared_groups():
    value = canonical_input(ImpurityInput.model_validate(body(
        reactants=["[Na+].CC(=O)[O-]", "N[C@@H](C)C(=O)O"],
        known_product="[13CH3]CO", solvents=["O"],
    )))
    assert len(value.reactants) == 2
    assert "[Na+]" in value.reactants[0]
    assert "@" in value.reactants[1]
    assert "[13CH3]" in value.known_product
    with pytest.raises(ValueError):
        canonical_input(ImpurityInput.model_validate(body(reactants=["C" * 60] * 3)))


def test_actual_mapper_output_contract_and_required_fragment_retention():
    mapped = "Cl[C:3]([CH3:4])=[O:5].[CH3:1][NH2:2]>>[CH3:1][NH:2][C:3]([CH3:4])=[O:5]"
    result = validate_mapping("CC(=O)Cl.CN", "CNC(C)=O", mapped, 0.99, ["CN"])
    assert result.mode_consistent
    assert result.required_fragments[0].retained_atoms == 2
    assert result.required_fragments[0].fraction == 1


def test_unmatched_substructure_and_second_monomer_do_not_vacuously_pass():
    mapped = "[CH3:1][NH2:2]>>[CH3:1][NH2:2]"
    assert not validate_mapping("CN", "CN", mapped, 1, ["CC"]).mode_consistent
    assert not validate_mapping("CN", "CN", mapped, 1, ["CN", "CN"]).mode_consistent


@pytest.mark.parametrize("mapped", [
    "[CH3:1]O>>CO", "[CH3:1][OH:1]>>[CH3:1][OH:1]",
    "[CH3:1][OH:2]>>[CH3:1][OH:3]", "[CH3:1][OH:2]>>[CH3:2][OH:1]",
    "[13CH3:1][OH:2]>>[CH3:1][OH:2]", "[CH3:1][OH:2]>>[CH3:1][NH2:2]",
])
def test_invalid_mapping_cannot_succeed(mapped):
    with pytest.raises(ValueError):
        validate_mapping("CO", "CO", mapped, 0.9)


def test_salt_mapping_checks_full_record_instead_of_stripping_counterion():
    mapped = "[Na+:5].[CH3:1][C:2](=[O:3])[O-:4]>>[Na+:5].[CH3:1][C:2](=[O:3])[O-:4]"
    result = validate_mapping("CC(=O)[O-].[Na+]", "CC(=O)[O-].[Na+]", mapped, 0.8, ["CC(=O)[O-].[Na+]"])
    assert result.mode_consistent
    assert result.required_fragments[0].supplied_atoms == 5
    assert result.required_fragments[0].retained_atoms == 5


@pytest.mark.parametrize("value", ["Cl", "[Na+].[Cl-]", "[13CH4]"])
def test_primary_atom_only_input_fails_before_any_provider(value):
    with pytest.raises(ValueError):
        canonical_input(ImpurityInput.model_validate(body(reactants=[value])))


def test_deuterium_mapping_cannot_be_replaced_by_another_isotope():
    valid = "[2H:1][CH2:2][OH:3]>>[2H:1][CH2:2][OH:3]"
    assert validate_mapping("[2H]CO", "[2H]CO", valid, 0.9).mode_consistent
    with pytest.raises(ValueError):
        validate_mapping("[2H]CO", "[2H]CO", valid.replace("[2H:1][CH2:2][OH:3]>>", "[3H:1][CH2:2][OH:3]>>"), 0.9)
