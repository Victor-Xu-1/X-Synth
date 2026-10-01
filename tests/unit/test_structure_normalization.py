from packages.chemistry.normalization import structure_identity_key


def test_structure_identity_key_ignores_protonation_state():
    phenoxide = "[O-]c1c(F)cccc1Br"
    phenol = "Oc1c(F)cccc1Br"

    assert structure_identity_key(phenoxide) == structure_identity_key(phenol)


def test_structure_identity_key_preserves_real_connectivity_changes():
    phenol = "Oc1c(F)cccc1Br"
    anisole = "COc1c(F)cccc1Br"

    assert structure_identity_key(phenol) != structure_identity_key(anisole)
