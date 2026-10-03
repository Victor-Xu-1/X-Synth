from packages.validation.template_forward import reconstruct, bond_family


PRODUCT = "CN(C)CCOC(c1ccccc1)c1ccccc1"
RETRO = "[C:4]-[O;H0;D2;+0:5]-[CH;D3;+0:1](-[c:2])-[c:3]>>Br-[CH;D3;+0:1](-[c:2])-[c:3].[C:4]-[OH;D1;+0:5]"


def test_reconstructs_actual_native_template_and_rejects_wrong_precursor():
    assert reconstruct(RETRO, "BrC(c1ccccc1)c1ccccc1.CN(C)CCO", PRODUCT)
    assert not reconstruct(RETRO, "BrC(c1ccccc1)c1ccccc1.CCN(CC)CCO", PRODUCT)


def test_leaving_group_variants_share_a_target_bond_family():
    assert bond_family(RETRO, PRODUCT)
    assert bond_family(RETRO, PRODUCT) == bond_family(RETRO.replace("Br-", "Cl-"), PRODUCT)
