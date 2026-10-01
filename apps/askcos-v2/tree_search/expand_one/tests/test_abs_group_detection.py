from expand_one_controller import _has_abs_groups


def test_detects_askcos_abstracted_group_isotopes():
    assert _has_abs_groups("[1CH3]C") is True
    assert _has_abs_groups("[5CH3]C") is True
    assert _has_abs_groups("[1NH2]C") is True


def test_preserves_normal_and_non_abstracted_isotopes():
    assert _has_abs_groups("CCO") is False
    assert _has_abs_groups("[13CH3]C") is False
    assert _has_abs_groups("[2NH2]C") is False
