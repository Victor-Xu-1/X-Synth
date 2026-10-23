"""Reconstruct native template proposals and group actual target bond edits."""

import hashlib
import json
from dataclasses import replace
from functools import lru_cache

from rdchiral.initialization import rdchiralReactants, rdchiralReaction
from rdchiral.main import rdchiralRun
from rdchiral.clean import combine_enantiomers_into_racemic
from rdkit import Chem

from packages.adapters.stock.commercial_stock import canonicalize_smiles
from packages.adapters.askcos.evidence_proposals import verify_exact_proposal
from packages.chemistry.reaction_centers import bonds, mapped_atoms


def templates(step):
    for evidence in step.metadata.get("model_metadata", []):
        template = (evidence.get("source") or {}).get("template") or {}
        smarts = template.get("reaction_smarts")
        if isinstance(smarts, str) and ">>" in smarts:
            yield smarts


@lru_cache(maxsize=2048)
def reconstruction(smarts, precursors, target):
    product_pattern, precursor_pattern = smarts.split(">>")
    matched = False
    try:
        reaction = rdchiralReaction(f"({precursor_pattern})>>({product_pattern})")
        reactants = rdchiralReactants(precursors)
        before = Chem.MolToSmiles(reactants.reactants, isomericSmiles=True)
        predicted, mapped = rdchiralRun(reaction, reactants, return_mapped=True)
        expected = canonicalize_smiles(target)
        matched = expected in {
            canonicalize_smiles(value) for value in predicted
        }
        witnesses = tuple((before, value[0]) for product, value in mapped.items()
                          if matched and canonicalize_smiles(product) == expected)
        if matched and not witnesses:
            expected_molecule = Chem.MolFromSmiles(expected)
            skeleton = Chem.MolToSmiles(expected_molecule, isomericSmiles=False)
            compatible = {
                product for product in mapped
                if (molecule := Chem.MolFromSmiles(product)) is not None
                and Chem.MolToSmiles(molecule, isomericSmiles=False) == skeleton
                and molecule.HasSubstructMatch(expected_molecule, useChirality=True)
            }
            # Use the same native consolidation, without changing target identity.
            if expected in {canonicalize_smiles(value) for value in combine_enantiomers_into_racemic(set(compatible))}:
                witnesses = tuple((before, mapped[product][0]) for product in sorted(compatible))
        return matched, witnesses
    except (ValueError, RuntimeError, IndexError, KeyError, AttributeError):
        return matched, ()


def reconstruct(smarts, precursors, target):
    return reconstruction(smarts, precursors, target)[0]


def bond_family(witnesses, product):
    """Only unanimous concrete mappings establish a target edit family."""
    target = canonicalize_smiles(product)
    signatures = [_witness_edits(before, after, target) for before, after in witnesses]
    if not signatures or signatures[0] is None or any(value != signatures[0] for value in signatures):
        return None
    digest = hashlib.sha256(
        json.dumps({"target": target, "edits": signatures[0]}, sort_keys=True).encode()
    ).hexdigest()[:16]
    return "target-bond-family:" + digest


def _witness_edits(before, after, target):
    try:
        precursor, product = Chem.MolFromSmiles(before), Chem.MolFromSmiles(after)
        if precursor is None or product is None or not target or canonicalize_smiles(after) != target:
            return None
        before_atoms, after_atoms = mapped_atoms(precursor), mapped_atoms(product)
        if (len(before_atoms) != precursor.GetNumAtoms() or len(after_atoms) != product.GetNumAtoms()
                or after_atoms.keys() - before_atoms.keys()
                or any((atom.GetAtomicNum(), atom.GetIsotope()) !=
                       (before_atoms[key].GetAtomicNum(), before_atoms[key].GetIsotope())
                       for key, atom in after_atoms.items())):
            return None
        # Deleted or changed precursor-directed bonds have no encoded edit roles.
        for bond in precursor.GetBonds():
            if not str(bond.GetBondType()).startswith("DATIVE"):
                continue
            donor, acceptor = bond.GetBeginAtom().GetAtomMapNum(), bond.GetEndAtom().GetAtomMapNum()
            if donor not in after_atoms or acceptor not in after_atoms:
                return None
            retained_bond = product.GetBondBetweenAtoms(after_atoms[donor].GetIdx(), after_atoms[acceptor].GetIdx())
            if (retained_bond is None or retained_bond.GetBondType() != bond.GetBondType()
                    or retained_bond.GetBeginAtom().GetAtomMapNum() != donor):
                return None
        positions = {key: atom.GetIdx() for key, atom in after_atoms.items()}
        retained = set(after_atoms)
        old, new = bonds(precursor, retained), bonds(product, retained)
        if any("UNSPECIFIED" in (old.get(pair), new.get(pair)) for pair in old.keys() | new.keys()):
            return None
        edits = {tuple(sorted(positions[key] for key in pair)): (old.get(pair), new.get(pair))
                 for pair in old.keys() | new.keys()
                 if set(pair) <= retained and old.get(pair) != new.get(pair)}
        if edits:
            graph = _joint_edit_graph(product, edits, set())
            return ("bonds", graph) if graph is not None else None
        # Leaving-group identity is not a new unmasking strategy. Keep one
        # occurrence per retained atom, including equivalent but distinct sites.
        anchors = {key for pair in old if not set(pair) <= retained for key in pair if key in retained}
        if anchors:
            graph = _joint_edit_graph(product, {}, {positions[key] for key in anchors})
            return ("unmasking", graph) if graph is not None else None
        return None
    except (ValueError, RuntimeError, KeyError):
        return None


def _joint_edit_graph(product, edits, anchors):
    """Canonicalize the full colored incidence graph, not independent sites.

    Dummy vertices encode labels only; their isotopes are color IDs, not
    chemical atoms or changes to the original target/witness molecules.
    """
    target = Chem.Mol(product)
    for atom in target.GetAtoms():
        atom.SetAtomMapNum(0)
    Chem.AssignStereochemistry(target, cleanIt=True, force=True)
    graph, labels = Chem.RWMol(), []

    def vertex(label):
        atom = Chem.Atom(0)
        atom.SetNoImplicit(True)
        index = graph.AddAtom(atom)
        labels.append(json.dumps(label, separators=(",", ":")))
        return index

    for atom in target.GetAtoms():
        if atom.GetChiralTag() != Chem.ChiralType.CHI_UNSPECIFIED and not atom.HasProp("_CIPCode"):
            return None
        vertex(("atom", atom.GetAtomicNum(), atom.GetIsotope(), atom.GetFormalCharge(),
                atom.GetTotalNumHs(), atom.GetNumRadicalElectrons(), atom.GetIsAromatic(),
                atom.GetProp("_CIPCode") if atom.HasProp("_CIPCode") else "", atom.GetIdx() in anchors))
    edges = {}
    for bond in target.GetBonds():
        stereo = bond.GetStereo()
        if stereo not in (Chem.BondStereo.STEREONONE, Chem.BondStereo.STEREOANY,
                          Chem.BondStereo.STEREOE, Chem.BondStereo.STEREOZ):
            return None
        pair = tuple(sorted((bond.GetBeginAtomIdx(), bond.GetEndAtomIdx())))
        edges[pair] = (str(bond.GetBondType()), str(stereo))
    for pair in edges.keys() | edits.keys():
        edge = vertex(("bond", edges.get(pair), edits.get(pair)))
        bond = target.GetBondBetweenAtoms(*pair)
        if bond is not None and str(bond.GetBondType()).startswith("DATIVE"):
            for role, endpoint in (("donor", bond.GetBeginAtomIdx()), ("acceptor", bond.GetEndAtomIdx())):
                port = vertex(("bond-role", role))
                graph.AddBond(edge, port, Chem.BondType.SINGLE)
                graph.AddBond(port, endpoint, Chem.BondType.SINGLE)
        else:
            for endpoint in pair:
                graph.AddBond(edge, endpoint, Chem.BondType.SINGLE)
    palette = tuple(sorted(set(labels)))
    colors = {label: index + 1 for index, label in enumerate(palette)}
    for atom, label in zip(graph.GetAtoms(), labels, strict=True):
        atom.SetIsotope(colors[label])
    return palette, Chem.MolToSmiles(graph, canonical=True)


def _target_family(prefix, product):
    return prefix + ":" + hashlib.sha256(canonicalize_smiles(product).encode()).hexdigest()[:16]


def validate_native_routes(routes, *, evidence_library=None):
    checked = []
    for route in routes:
        results = []
        target = canonicalize_smiles(route.target_smiles)
        target_steps = [step for step in route.steps if canonicalize_smiles(step.product) == target]
        first = target_steps[0] if len(target_steps) == 1 else None
        family = _target_family("unresolved-target-family", route.target_smiles) if first is None else None
        methods = []
        for step in route.steps:
            matching = []
            for smarts in dict.fromkeys(templates(step)):
                matched, witnesses = reconstruction(smarts, ".".join(step.precursors), step.product)
                if matched:
                    matching.append(witnesses)
            recorded = [
                evidence for evidence in step.metadata.get("model_metadata", [])
                if evidence.get("backend") == "exact_match" and evidence.get("model_name") == "ORD"
            ]
            exact = bool(recorded) and evidence_library is not None and all(
                verify_exact_proposal(evidence, step, evidence_library) for evidence in recorded
            )
            consistent = bool(matching) or exact
            if recorded and not exact:
                consistent = False
            results.append(consistent)
            methods.append("template_reconstruction" if matching else "exact_record_identity" if exact else "unmatched")
            if step is first and matching:
                witnesses = tuple(witness for group in matching for witness in group)
                family = bond_family(witnesses, step.product) if all(matching) else None
                family = family or _target_family("unresolved-target-family", step.product)
            elif step is first and exact:
                # Unmapped records cannot establish distinct bond-change families.
                family = _target_family("recorded-target-family", step.product)
        checked.append(
            replace(
                route,
                family_key=family or route.family_key,
                metadata={
                    **route.metadata,
                    "forward_validation_passed": bool(results) and all(results),
                    "forward_validation_method": "native_template_or_exact_record_consistency"
                    if "exact_record_identity" in methods else "native_template_reconstruction",
                    "full_forward_prediction_validated": False,
                    "forward_validation_steps": results,
                    "proposal_consistency_methods": methods,
                },
            )
        )
    return checked
