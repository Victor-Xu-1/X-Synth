from dataclasses import asdict, replace
import hashlib
from itertools import combinations
from pathlib import Path

import pytest
from rdkit import Chem

from packages.route_pool.askcos import _family_key
from packages.route_schema.route_schema import RouteCandidate, RouteStep
from packages.adapters.stock.commercial_stock import canonicalize_smiles
from packages.validation.route_topology import topology_reasons
from packages.validation.template_forward import reconstruct, reconstruction, bond_family, validate_native_routes
from test_evidence_route_integration import recorded_route


PRODUCT = "CN(C)CCOC(c1ccccc1)c1ccccc1"
RETRO = "[C:4]-[O;H0;D2;+0:5]-[CH;D3;+0:1](-[c:2])-[c:3]>>Br-[CH;D3;+0:1](-[c:2])-[c:3].[C:4]-[OH;D1;+0:5]"
UNMASK_N = "[N;H2:1]>>[N;H1:1]C(=O)OC(C)(C)C"


def joint_edit_controls(kind):
    if kind == "unmasking":
        return ("Oc1c(O)cc(O)c(O)c1",
                "[OH:7][c:1]1[c:2]([OH:8])[cH:3][c:4]([OH:9])[c:5]([OH:10])[cH:6]1",
                "[CH3:11][C:12](=[O:13])[O:7][c:1]1[c:2]([O:8][C:14](=[O:15])[CH3:16])"
                "[cH:3][c:4]([OH:9])[c:5]([OH:10])[cH:6]1",
                "[CH3:11][C:12](=[O:13])[O:7][c:1]1[c:2]([OH:8])[cH:3]"
                "[c:4]([O:9][C:14](=[O:15])[CH3:16])[c:5]([OH:10])[cH:6]1")
    if kind == "bond-order":
        return ("C1CCCCCCC1", "[CH2:1]1[CH2:2][CH2:3][CH2:4][CH2:5][CH2:6][CH2:7][CH2:8]1",
                "[CH:1]1=[CH:2][CH:3]=[CH:4][CH2:5][CH2:6][CH2:7][CH2:8]1",
                "[CH:1]1=[CH:2][CH2:3][CH2:4][CH:5]=[CH:6][CH2:7][CH2:8]1")
    return ("C1CCCCC1", "[CH2:1]1[CH2:2][CH2:3][CH2:4][CH2:5][CH2:6]1",
            "[CH3:1][CH2:6][CH2:5][CH2:4][CH3:3].[CH4:2]",
            "[CH3:1][CH2:6][CH3:5].[CH3:2][CH2:3][CH3:4]")


@pytest.mark.parametrize("kind", ["unmasking", "bond-formation", "bond-order"])
def test_joint_edit_arrangements_are_not_independent_symmetry_rank_multisets(kind):
    target, after, adjacent, opposite = joint_edit_controls(kind)
    assert canonicalize_smiles(after) == canonicalize_smiles(target)
    assert Chem.MolFromSmiles(adjacent) is not None and Chem.MolFromSmiles(opposite) is not None
    if kind == "unmasking":
        molecule = Chem.MolFromSmiles(after)
        positions = {atom.GetAtomMapNum(): atom.GetIdx() for atom in molecule.GetAtoms()}
        assert len(Chem.GetShortestPath(molecule, positions[7], positions[8])) - 1 == 3
        assert len(Chem.GetShortestPath(molecule, positions[7], positions[9])) - 1 == 5
    first = bond_family([(adjacent, after)], target)
    second = bond_family([(opposite, after)], target)
    assert first and second
    assert first != second


def permute_witness(witness, offset):
    result = []
    for value in witness:
        molecule = Chem.MolFromSmiles(value)
        for atom in molecule.GetAtoms():
            atom.SetAtomMapNum(atom.GetAtomMapNum() * 31 + offset + 1)
        indices = list(range(molecule.GetNumAtoms()))
        start = offset % len(indices)
        indices = indices[start:] + indices[:start]
        if offset % 2:
            indices.reverse()
        result.append(Chem.MolToSmiles(Chem.RenumberAtoms(molecule, indices),
                                      canonical=False, isomericSmiles=True))
    return tuple(result)


@pytest.mark.parametrize("kind", ["unmasking", "bond-formation", "bond-order"])
def test_joint_graph_preserves_atom_order_and_map_renumbering_invariance(kind):
    target, after, first, second = joint_edit_controls(kind)
    for before in (first, second):
        expected = bond_family([(before, after)], target)
        assert expected
        for offset in range(12):
            witness = permute_witness((before, after), offset)
            assert canonicalize_smiles(witness[1]) == canonicalize_smiles(target)
            assert bond_family([witness], target) == expected


@pytest.mark.parametrize("kind", ["unmasking", "bond-formation", "bond-order"])
def test_joint_graph_identifies_actual_target_automorphisms(kind):
    target, after, before, _ = joint_edit_controls(kind)
    permutation = ({1: 4, 2: 5, 3: 6, 4: 1, 5: 2, 6: 3, 7: 9, 8: 10, 9: 7, 10: 8}
                   if kind == "unmasking" else
                   {index: (index + 1) % (8 if kind == "bond-order" else 6) + 1
                    for index in range(1, 9 if kind == "bond-order" else 7)})
    molecule = Chem.MolFromSmiles(before)
    for atom in molecule.GetAtoms():
        atom.SetAtomMapNum(permutation.get(atom.GetAtomMapNum(), atom.GetAtomMapNum()))
    rotated = Chem.MolToSmiles(molecule)
    assert canonicalize_smiles(rotated) == canonicalize_smiles(before)
    first, second = bond_family([(before, after)], target), bond_family([(rotated, after)], target)
    assert first and first == second


@pytest.mark.parametrize("kind", ["unmasking", "bond-formation", "bond-order"])
def test_conflicting_joint_witnesses_remain_unknown_in_either_order(kind):
    target, after, first, second = joint_edit_controls(kind)
    witnesses = [(first, after), (second, after)]
    assert bond_family(witnesses, target) is None
    assert bond_family(list(reversed(witnesses)), target) is None


def test_joint_unmasking_arrangement_ignores_protecting_group_variants():
    target, after, before, _ = joint_edit_controls("unmasking")
    variant = Chem.RWMol(Chem.MolFromSmiles(before))
    for identifier, new_map in ((11, 17), (16, 18)):
        atom = next(atom for atom in variant.GetAtoms() if atom.GetAtomMapNum() == identifier)
        atom.SetNumExplicitHs(2)
        added = Chem.Atom(6)
        added.SetAtomMapNum(new_map)
        variant.AddBond(atom.GetIdx(), variant.AddAtom(added), Chem.BondType.SINGLE)
    Chem.SanitizeMol(variant)
    changed = Chem.MolToSmiles(variant)
    assert canonicalize_smiles(changed) != canonicalize_smiles(before)
    first, second = bond_family([(before, after)], target), bond_family([(changed, after)], target)
    assert first and first == second


@pytest.mark.parametrize("target,precursor", [
    ("N[C@H](C)CO", "CC(C)(C)OC(=O)N[C@H](C)CO"),
    ("[15NH2]CCO", "CC(C)(C)OC(=O)[15NH]CCO"),
    ("N/C=C/CO", "CC(C)(C)OC(=O)N/C=C/CO"),
])
def test_joint_graph_retains_concrete_stereo_and_isotope_invariance(target, precursor):
    matched, witnesses = reconstruction(UNMASK_N, precursor, target)
    assert matched and witnesses
    family = bond_family(witnesses, target)
    assert family
    for offset in range(6):
        permuted = [permute_witness(witness, offset) for witness in witnesses]
        assert bond_family(permuted, target) == family


def test_joint_graph_retains_deleted_target_bonds_as_edit_relations():
    target = "CCCCCC"
    before = "[CH2:1]1[CH2:2][CH2:3][CH2:4][CH2:5][CH2:6]1"
    after = "[CH3:1][CH2:2][CH2:3][CH2:4][CH2:5][CH3:6]"
    family = bond_family([(before, after)], target)
    assert family
    assert bond_family([permute_witness((before, after), 5)], target) == family


def test_joint_graph_preserves_directed_target_bond_endpoint_roles():
    # Native RDKit graph identity only, not a synthesis or mechanism claim.
    target, after = "[Fe]->[Fe]->[Fe]", "[Fe:1]->[Fe:2]->[Fe:3]"
    donor = "[Cl:4][Fe:1]->[Fe:2]->[Fe:3]"
    acceptor = "[Fe:1]->[Fe:2]->[Fe:3][Cl:4]"
    first, second = bond_family([(donor, after)], target), bond_family([(acceptor, after)], target)
    assert first and second and first != second
    for offset in range(6):
        for before, expected in ((donor, first), (acceptor, second)):
            witness = permute_witness((before, after), offset)
            # Keep the existing exact-identity guard even for dative aliases
            # whose native canonical text differs after serialization.
            same_identity = canonicalize_smiles(witness[1]) == canonicalize_smiles(target)
            assert bond_family([witness], target) == (expected if same_identity else None)


def test_deleted_precursor_directed_bond_roles_are_explicitly_unresolved():
    target, after = "[Cu].[Fe]", "[Cu:1].[Fe:2]"
    witnesses = [("[Cu:1]->[Fe:2]", after), ("[Cu:1]<-[Fe:2]", after)]
    families = [bond_family([witness], target) for witness in witnesses]
    assert families == [None, None]
    assert bond_family(witnesses, target) is None
    assert bond_family(list(reversed(witnesses)), target) is None
    for witness in witnesses:
        for offset in range(6):
            permuted = permute_witness(witness, offset)
            assert canonicalize_smiles(permuted[1]) == canonicalize_smiles(target)
            assert bond_family([permuted], target) is None


@pytest.mark.parametrize("component,precursor", [
    ("[CH3:3][OH:4]", "[CH3:3][O:4][CH3:5]"),
    ("[CH3:3][CH3:4]", "[CH4:3].[CH4:4]"),
])
def test_precursor_direction_flip_cannot_hide_behind_another_edit(component, precursor):
    after = "[Cu:1]->[Fe:2]." + component
    target = canonicalize_smiles(after)
    retained = "[Cu:1]->[Fe:2]." + precursor
    flipped = "[Cu:1]<-[Fe:2]." + precursor
    family = bond_family([(retained, after)], target)
    assert family
    assert bond_family([(flipped, after)], target) is None
    for offset in range(6):
        unchanged = permute_witness((retained, after), offset)
        reversed_direction = permute_witness((flipped, after), offset)
        assert canonicalize_smiles(unchanged[1]) == target
        assert canonicalize_smiles(reversed_direction[1]) == target
        assert bond_family([unchanged], target) == family
        assert bond_family([reversed_direction], target) is None


@pytest.mark.parametrize("after", ["[Cu:1]->[Fe:2]", "[Cu:1]<-[Fe:2]"])
def test_new_target_directed_bonds_remain_supported_and_map_invariant(after):
    target, before = canonicalize_smiles(after), "[Cu:1].[Fe:2]"
    family = bond_family([(before, after)], target)
    assert family
    for offset in range(6):
        witness = permute_witness((before, after), offset)
        assert canonicalize_smiles(witness[1]) == target
        assert bond_family([witness], target) == family


@pytest.mark.parametrize("after", ["[Cu:1]", "[Fe:2]"])
def test_precursor_directed_bond_with_a_deleted_endpoint_is_unresolved(after):
    target = canonicalize_smiles(after)
    for before in ("[Cu:1]->[Fe:2]", "[Cu:1]<-[Fe:2]"):
        assert bond_family([(before, after)], target) is None
        assert bond_family([permute_witness((before, after), 3)], target) is None


def test_precursor_directed_bond_type_change_is_unresolved():
    after = "[Cu:1]-[Fe:2]"
    target = canonicalize_smiles(after)
    for before in ("[Cu:1]->[Fe:2]", "[Cu:1]<-[Fe:2]"):
        assert bond_family([(before, after)], target) is None
        assert bond_family([permute_witness((before, after), 3)], target) is None


def precursor_for_joint_sites(product, sites, kind):
    molecule = Chem.RWMol(product)
    if kind == "unmasking":
        next_map = max(atom.GetAtomMapNum() for atom in molecule.GetAtoms()) + 1
        for site in sites:
            molecule.GetAtomWithIdx(site).SetNumExplicitHs(0)
            added = []
            for element in (6, 8, 6):
                atom = Chem.Atom(element)
                atom.SetAtomMapNum(next_map)
                next_map += 1
                added.append(molecule.AddAtom(atom))
            molecule.AddBond(site, added[0], Chem.BondType.SINGLE)
            molecule.AddBond(added[0], added[1], Chem.BondType.DOUBLE)
            molecule.AddBond(added[0], added[2], Chem.BondType.SINGLE)
    else:
        for pair in sites:
            molecule.RemoveBond(*pair)
        for atom in molecule.GetAtoms():
            atom.SetNumExplicitHs(4 - atom.GetDegree())
    Chem.SanitizeMol(molecule)
    return Chem.MolToSmiles(molecule)


@pytest.mark.parametrize("kind", ["unmasking", "bond-formation"])
def test_joint_families_match_full_target_automorphism_orbits(kind):
    target, after, _, _ = joint_edit_controls(kind)
    product = Chem.MolFromSmiles(after)
    plain = Chem.Mol(product)
    for atom in plain.GetAtoms():
        atom.SetAtomMapNum(0)
    # Independent complete-target oracle, never a production query fallback.
    automorphisms = plain.GetSubstructMatches(plain, uniquify=False, useChirality=True, maxMatches=256)
    assert 0 < len(automorphisms) < 256
    sites = ([atom.GetIdx() for atom in product.GetAtoms() if atom.GetAtomicNum() == 8]
             if kind == "unmasking" else
             [tuple(sorted((bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()))) for bond in product.GetBonds()])
    expected_families, observed_orbits = {}, {}
    for selected in combinations(sites, 2):
        orbit = min(tuple(sorted(match[site] for site in selected)) if kind == "unmasking" else
                    tuple(sorted(tuple(sorted(match[atom] for atom in pair)) for pair in selected))
                    for match in automorphisms)
        before = precursor_for_joint_sites(product, selected, kind)
        family = bond_family([(before, after)], target)
        assert family
        assert expected_families.setdefault(orbit, family) == family
        assert observed_orbits.setdefault(family, orbit) == orbit


def test_native_family_authority_has_no_retired_heuristic_fallback():
    assert not (Path(__file__).resolve().parents[2] / "packages/route_pool/family.py").exists()


def test_reconstructs_actual_native_template_and_rejects_wrong_precursor():
    assert reconstruct(RETRO, "BrC(c1ccccc1)c1ccccc1.CN(C)CCO", PRODUCT)
    assert not reconstruct(RETRO, "BrC(c1ccccc1)c1ccccc1.CCN(CC)CCO", PRODUCT)


def test_leaving_group_variants_share_a_target_bond_family():
    families = []
    for leaving_group in ("Br", "Cl"):
        matched, witnesses = reconstruction(RETRO.replace("Br-", leaving_group + "-"),
                                            leaving_group + "C(c1ccccc1)c1ccccc1.CN(C)CCO", PRODUCT)
        assert matched and witnesses
        families.append(bond_family(witnesses, PRODUCT))
    assert families[0] and families[0] == families[1]


def candidate(identifier, product, precursors, *smarts):
    # Controlled parser/identity inputs, not model or experimental certification.
    step = RouteStep("s1", ".".join(precursors) + ">>" + product, precursors, product,
                     "controlled-template", confidence=0.8, metadata={
                         "model_metadata": [{"source": {"template": {"reaction_smarts": value}}}
                                            for value in smarts],
                     })
    return RouteCandidate(identifier, "askcos_mcts", product, [step], precursors,
                          closed=True, family_key=_family_key([step], precursors),
                          evidence_refs=[identifier], metadata={"source_receipt": identifier})


def test_generic_template_family_binds_the_actual_target_bond():
    product = "CC(=O)NCCNC(=O)CCC"
    smarts = "[C:1](=[O:2])-[N:3]>>[C:1](=[O:2])Cl.[N:3]"
    routes = [candidate("left-amide", product, ["CC(=O)Cl", "NCCNC(=O)CCC"], smarts),
              candidate("right-amide", product, ["CCCC(=O)Cl", "CC(=O)NCCN"], smarts)]
    before = [asdict(route) for route in routes]
    checked = validate_native_routes(routes)
    assert all(route.metadata["forward_validation_passed"] for route in checked)
    assert all(route.family_key.startswith("target-bond-family:") for route in checked)
    assert checked[0].family_key != checked[1].family_key
    assert [asdict(route) for route in routes] == before


def test_unmasking_variants_share_the_retained_target_site():
    routes = [candidate("carbamate-a", "NCCO", ["CC(C)(C)OC(=O)NCCO"],
                        "[N;H2:1]>>[N;H1:1]C(=O)OC(C)(C)C"),
              candidate("carbamate-b", "NCCO", ["O=C(OCc1ccccc1)NCCO"],
                        "[N;H2:1]>>[N;H1:1]C(=O)OCc1ccccc1")]
    before = [asdict(route) for route in routes]
    checked = validate_native_routes(routes)
    assert all(route.metadata["forward_validation_passed"] for route in checked)
    assert checked[0].family_key == checked[1].family_key
    assert checked[0].family_key.startswith("target-bond-family:")
    assert [asdict(route) for route in routes] == before


def test_different_unmasking_sites_do_not_merge():
    routes = [candidate("nitrogen", "NCCO", ["CC(C)(C)OC(=O)NCCO"], UNMASK_N),
              candidate("oxygen", "NCCO", ["NCCOC(C)=O"], "[O;H1:1]>>[O;H0:1]C(=O)C")]
    checked = validate_native_routes(routes)
    assert all(route.metadata["forward_validation_passed"] for route in checked)
    assert all(route.family_key.startswith("target-bond-family:") for route in checked)
    assert checked[0].family_key != checked[1].family_key


def test_equivalent_unmasking_atoms_retain_the_number_of_distinct_sites():
    double = ("[N;H2:1][CH2:3][CH2:4][N;H2:2]>>"
              "CC(C)(C)OC(=O)[N;H1:1][CH2:3][CH2:4][N;H1:2]C(=O)OC(C)(C)C")
    routes = [candidate("single", "NCCN", ["CC(C)(C)OC(=O)NCCN"], UNMASK_N),
              candidate("double", "NCCN", ["CC(C)(C)OC(=O)NCCNC(=O)OC(C)(C)C"], double)]
    checked = validate_native_routes(routes)
    assert all(route.metadata["forward_validation_passed"] for route in checked)
    assert all(route.family_key.startswith("target-bond-family:") for route in checked)
    assert checked[0].family_key != checked[1].family_key


@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize("complete_mapping", [False, True])
def test_all_valid_templates_must_agree_instead_of_selecting_the_first(reverse, complete_mapping):
    # Both native reconstructions reach the exact product, with incompatible
    # retained sites (or missing correspondence), not competing model providers.
    first = "[N;H2:1]>>[N;H1:1]CC"
    middle = "[CH2:4][CH2:5]" if complete_mapping else "CC"
    second = f"[N;H2:1]{middle}[N;H1:2][CH3:3]>>C[N;H1:1]{middle}[N;H1:2][CH2:3]C"
    smarts = [first, second]
    if reverse:
        smarts.reverse()
    route = candidate("ambiguous", "NCCNC", ["CNCCNCC"], *smarts)
    for template in smarts:
        assert reconstruction(template, "CNCCNCC", "NCCNC")[0]
    checked, = validate_native_routes([route])
    assert checked.metadata["forward_validation_passed"]
    assert checked.family_key.startswith("unresolved-target-family:")
    other, = validate_native_routes([replace(route, family_key="different-native-hash",
        steps=[replace(route.steps[0], metadata={"model_metadata": list(reversed(
            route.steps[0].metadata["model_metadata"]))})])])
    assert checked.family_key == other.family_key


def test_equivalent_templates_and_unmatched_templates_do_not_change_the_family():
    equivalent = UNMASK_N.replace(":1]", ":42]")
    unmatched = "[N;H2:1]>>[N;H1:1]C(=O)C"
    source = candidate("one", "NCCO", ["CC(C)(C)OC(=O)NCCO"], UNMASK_N)
    reference, = validate_native_routes([source])
    for templates in [(unmatched, equivalent, UNMASK_N), (UNMASK_N, equivalent, unmatched)]:
        checked, = validate_native_routes([candidate("many", "NCCO", source.starting_materials, *templates)])
        assert checked.metadata["forward_validation_passed"]
        assert checked.family_key == reference.family_key


def test_concrete_atom_numbering_and_smiles_order_are_not_family_identity():
    matched, witnesses = reconstruction(UNMASK_N, "CC(C)(C)OC(=O)NCCO", "NCCO")
    assert matched and witnesses
    permuted = []
    for witness in witnesses:
        row = []
        for value in witness:
            molecule = Chem.MolFromSmiles(value)
            for atom in molecule.GetAtoms():
                atom.SetAtomMapNum(atom.GetAtomMapNum() + 100)
            row.append(Chem.MolToSmiles(molecule, canonical=False,
                                       rootedAtAtom=molecule.GetNumAtoms() - 1))
        permuted.append(tuple(row))
    assert bond_family(witnesses, "NCCO") == bond_family(permuted, "OCCN")


@pytest.mark.parametrize("target", [
    "N[C@@H](C)CO", "[15NH2][C@H](C)CO", "N[C@H](C)CO.[Cl-]",
    "N[C@H](C)CO.[Cl-].[Cl-]", "N[C@H](C)CO.N[C@H](C)CO",
])
def test_witness_binding_does_not_flatten_stereo_isotopes_salts_or_multiplicity(target):
    product = "N[C@H](C)CO"
    matched, witnesses = reconstruction(UNMASK_N, "CC(C)(C)OC(=O)N[C@H](C)CO", product)
    assert matched and witnesses and bond_family(witnesses, product)
    assert bond_family(witnesses, target) is None


@pytest.mark.parametrize("invalid", ["missing-map", "duplicate-map", "different-isotope", "unspecified-bond"])
def test_invalid_retained_atom_correspondence_is_unresolved(invalid):
    matched, witnesses = reconstruction(UNMASK_N, "CC(C)(C)OC(=O)NCCO", "NCCO")
    assert matched and witnesses
    before, after = witnesses[0]
    molecule = Chem.MolFromSmiles(after)
    first, second = list(molecule.GetAtoms())[:2]
    if invalid == "missing-map":
        first.SetAtomMapNum(0)
    elif invalid == "duplicate-map":
        first.SetAtomMapNum(second.GetAtomMapNum())
    elif invalid == "different-isotope":
        precursor = Chem.MolFromSmiles(before)
        next(atom for atom in precursor.GetAtoms()
             if atom.GetAtomMapNum() == first.GetAtomMapNum()).SetIsotope(15)
        before = Chem.MolToSmiles(precursor)
    else:
        precursor = Chem.MolFromSmiles(before)
        retained = {atom.GetAtomMapNum() for atom in molecule.GetAtoms()}
        next(bond for bond in precursor.GetBonds()
             if {bond.GetBeginAtom().GetAtomMapNum(), bond.GetEndAtom().GetAtomMapNum()} <= retained
             ).SetBondType(Chem.BondType.UNSPECIFIED)
        before = Chem.MolToSmiles(precursor)
    assert bond_family([(before, Chem.MolToSmiles(molecule))], "NCCO") is None
    assert bond_family([], "NCCO") is None


def test_target_step_is_independent_of_serialized_valid_dag_order():
    root = candidate("dag", "CC(=O)NCCc1ccccc1", ["CC(=O)Cl", "NCCc1ccccc1"],
                     "[C:1](=[O:2])-[N:3]>>[C:1](=[O:2])Cl.[N:3]")
    feed = candidate("feed", "NCCc1ccccc1", ["CC(C)(C)OC(=O)NCCc1ccccc1"], UNMASK_N)
    feed_step = replace(feed.steps[0], step_id="feed")
    routes = [replace(root, steps=steps,
                      starting_materials=["CC(=O)Cl", *feed.starting_materials],
                      family_key=_family_key(steps, []))
              for steps in [[root.steps[0], feed_step], [feed_step, root.steps[0]]]]
    assert all(topology_reasons(route) == () for route in routes)
    checked = validate_native_routes(routes)
    assert all(route.metadata["forward_validation_passed"] for route in checked)
    assert checked[0].family_key == checked[1].family_key
    assert checked[0].family_key.startswith("target-bond-family:")
    for original, result in zip(routes, checked, strict=True):
        assert result.steps == original.steps
        assert result.evidence_refs == original.evidence_refs
        assert result.metadata["source_receipt"] == original.metadata["source_receipt"]
        assert result.metadata["full_forward_prediction_validated"] is False


def test_exact_record_target_family_and_reconstruction_proof_remain_unchanged(recorded_route):
    route, library = recorded_route
    before = asdict(route)
    checked, = validate_native_routes([route], evidence_library=library)
    expected = "recorded-target-family:" + hashlib.sha256(
        canonicalize_smiles(route.target_smiles).encode()).hexdigest()[:16]
    assert checked.family_key == expected
    assert checked.metadata["forward_validation_passed"]
    assert checked.metadata["proposal_consistency_methods"] == ["exact_record_identity"]
    assert checked.metadata["full_forward_prediction_validated"] is False
    assert checked.steps == route.steps and checked.evidence_refs == route.evidence_refs
    assert asdict(route) == before
