import itertools
import random
from collections import defaultdict

import numpy as np
from rdkit import Chem

from wln.constants import ELEMENTS, BOND_TYPES
from wln.utils import (
    onek_encoding_unk,
    pack2D_withidx,
    get_atom_idx,
)
from wln.rank.edit_mol import get_product_smiles

atom_fdim = len(ELEMENTS) + 7 + 6 + 6 + 6 + 1
bond_fdim = 5
max_nb = 10


def atom_features(atom):
    return np.array(
        onek_encoding_unk(atom.GetSymbol(), ELEMENTS)
        + onek_encoding_unk(atom.GetFormalCharge(), [-3, -2, -1, 0, 1, 2, 3])
        + onek_encoding_unk(atom.GetDegree(), [0, 1, 2, 3, 4, 5])
        + onek_encoding_unk(atom.GetExplicitValence(), [1, 2, 3, 4, 5, 6])
        + onek_encoding_unk(atom.GetImplicitValence(), [0, 1, 2, 3, 4, 5])
        + [atom.GetIsAromatic()],
        dtype=np.float32,
    )


def bond_features(bond):
    bt = bond.GetBondType()
    return np.array(
        [
            bt == Chem.rdchem.BondType.SINGLE,
            bt == Chem.rdchem.BondType.DOUBLE,
            bt == Chem.rdchem.BondType.TRIPLE,
            bt == Chem.rdchem.BondType.AROMATIC,
            bond.IsInRing(),
        ],
        dtype=np.float32,
    )


def smiles2graph(
    rsmiles,
    psmiles,
    core_bonds,
    gold_bonds,
    cutoff=500,
    idxfunc=get_atom_idx,
    core_size=20,
    kmax=5,
    return_found=False,
    testing=False,
):
    """
    This is the function that takes reactants, a true product (when defined),
    and the candidate bonds to generate all of the candidate products according
    to some bounds on the enumeration
    """
    mol = Chem.MolFromSmiles(rsmiles)
    if not mol:
        raise ValueError("Could not parse smiles string:", rsmiles)

    if not testing:
        pmol = Chem.MolFromSmiles(psmiles)
        if not pmol:
            raise ValueError("Could not parse smiles string:", psmiles)

    n_atoms = mol.GetNumAtoms()
    n_bonds = max(mol.GetNumBonds(), 1)
    fatoms = np.zeros((n_atoms, atom_fdim))
    fbonds = np.zeros((n_bonds, bond_fdim))
    atom_nb = np.zeros((n_atoms, max_nb), dtype=np.int32)
    bond_nb = np.zeros((n_atoms, max_nb), dtype=np.int32)
    num_nbs = np.zeros((n_atoms,), dtype=np.int32)
    raw_atom_nb = np.zeros((n_atoms, max_nb), dtype=np.int32)
    raw_bond_nb = np.zeros((n_atoms, max_nb), dtype=np.int32)
    raw_num_nbs = np.zeros((n_atoms,), dtype=np.int32)
    free_vals = np.zeros((n_atoms,))
    pfree_vals = np.zeros((n_atoms,))

    is_c2_of_pyridine = np.zeros((n_atoms,), dtype=bool)
    is_c = np.zeros((n_atoms,), dtype=bool)
    is_p = np.zeros((n_atoms,), dtype=bool)
    is_s = np.zeros((n_atoms,), dtype=bool)
    is_o = np.zeros((n_atoms,), dtype=bool)
    is_n = np.zeros((n_atoms,), dtype=bool)

    # Feature Extraction
    for atom in mol.GetAtoms():
        idx = idxfunc(atom)
        fatoms[idx] = atom_features(atom)
        free_vals[idx] += atom.GetTotalNumHs() + abs(atom.GetFormalCharge())

        # TODO: review these rules
        # Aromatic carbon next to an aromatic nitrogen can get a carbonyl b/c stupid bookkeeping of hydroxypyridines
        if atom.GetAtomicNum() == 6:
            is_c[idx] = True
            if atom.GetIsAromatic():
                for nbr in atom.GetNeighbors():
                    if nbr.GetAtomicNum() == 7 and nbr.GetDegree() == 2:
                        is_c2_of_pyridine[idx] = True
                        break
        #  Nitrogen should be allowed to become positively charged
        elif atom.GetAtomicNum() == 7:
            free_vals[idx] += 1 - atom.GetFormalCharge()
            is_n[idx] = True
        # Phosphorous can form a phosphonium
        elif atom.GetAtomicNum() == 15:
            free_vals[idx] += 1 - atom.GetFormalCharge()
            is_p[idx] = True
        elif atom.GetAtomicNum() == 8:
            is_o[idx] = True
        elif atom.GetAtomicNum() == 16:
            is_s[idx] = True

        # special information needed for valence filtering

    if not testing:
        tatoms = set()
        # Calculate free slots for each atom in product
        for bond in pmol.GetBonds():
            a1 = idxfunc(bond.GetBeginAtom())
            a2 = idxfunc(bond.GetEndAtom())
            t = BOND_TYPES.index(bond.GetBondType())
            a1, a2 = min(a1, a2), max(a1, a2)
            tatoms.add(a1)
            tatoms.add(a2)
            if (a1, a2) in core_bonds:
                # gbonds[(a1,a2)] = t
                tval = t if t < 4 else 1.5
                pfree_vals[a1] += tval
                pfree_vals[a2] += tval

    rbonds = {}
    rbond_vals = {}  # bond orders
    ring_bonds = set()
    # Calculate free slots for each atom in reactant
    for bond in mol.GetBonds():
        idx = bond.GetIdx()
        a1 = idxfunc(bond.GetBeginAtom())
        a2 = idxfunc(bond.GetEndAtom())
        t = BOND_TYPES.index(bond.GetBondType())
        a1, a2 = min(a1, a2), max(a1, a2)
        tval = t if t < 4 else 1.5
        rbonds[(a1, a2)] = t
        rbond_vals[(a1, a2)] = tval
        if (a1, a2) in core_bonds:
            free_vals[a1] += tval
            free_vals[a2] += tval
        if bond.IsInRing():
            ring_bonds.add((a1, a2))

    # Get all possible core configurations - NEW IN DIRECT VERSION
    # will be list of lists of (x, y, t, v) tuples, where t is the bond order and v is CoreFinder score
    core_configs = []

    # Filter out core bonds that exactly match reactants
    core_bonds = [
        (x, y, t, v)
        for (x, y, t, v) in core_bonds
        if ((x, y) not in rbond_vals) or (rbond_vals[(x, y)] != t)
    ]

    # Pare down to top-core_size only
    core_bonds = core_bonds[:core_size]

    # Helper function to check if a combination is connected - this helps the number of valid combinations
    core_bonds_adj = np.eye(len(core_bonds), dtype=bool)
    for i in range(len(core_bonds)):
        a1, b1, t1, v1 = core_bonds[i]
        for j in range(i, len(core_bonds)):
            a2, b2, t2, v2 = core_bonds[j]
            if a1 == a2 or a1 == b2 or b1 == a2 or b1 == b2:
                core_bonds_adj[i, j] = core_bonds_adj[j, i] = True

    # print('Calculated core bonds adj matrix: {}'.format(core_bonds_adj * 1.0))

    def check_if_connected(combo_i):
        """Checks if a set of candidate edits (by indeces) are all connected"""
        if len(combo_i) == 1:
            return True  # only one change, always connected
        temp_adj_pow = np.linalg.matrix_power(
            core_bonds_adj[combo_i, :][:, combo_i], len(combo_i) - 1
        )
        return np.all(temp_adj_pow)

    def check_if_valid(bond_change_combo):
        """Helper function to check if a combination is valid"""
        force_even_parity = np.zeros((n_atoms,), dtype=bool)
        force_odd_parity = np.zeros((n_atoms,), dtype=bool)
        seen = defaultdict(lambda: False)
        free_vals_temp = free_vals.copy()
        # print(free_vals_temp)
        for x, y, t, v in bond_change_combo:
            x, y = tuple(sorted([x, y]))
            if seen[(x, y)]:
                return False  # can't have two distinct bond change types in same combo
            seen[(x, y)] = True

            # TODO: review these valence rules
            # Special rules:
            #  - if phosphorous or sulfur, don't count formation of =O toward valence but require odd/even
            #  - if c2 carbon in a pyridine ring, let it get a =O
            tx = ty = t
            if t == 2:
                if is_o[x]:
                    if is_c2_of_pyridine[y]:
                        # pretend it's just a hydroxylation for the sake of valence
                        ty = 1.0
                    elif is_p[y]:
                        ty = 0.0  # don't count toward valence
                        force_odd_parity[y] = True  # but require odd valence parity
                    elif is_s[y]:
                        ty = 0.0
                        force_even_parity[y] = True

                elif is_o[y]:
                    if is_c2_of_pyridine[x]:
                        tx = 1.0
                    elif is_p[x]:
                        tx = 0.0
                        force_odd_parity[x] = True
                    elif is_s[x]:
                        tx = 0.0
                        force_even_parity[x] = True

                elif is_n[x] and is_p[y]:
                    ty = 0.0
                    force_odd_parity[y] = True
                elif is_n[y] and is_p[x]:
                    tx = 0.0
                    force_odd_parity[x] = True

                elif is_p[x] and is_c[y]:
                    tx = 0.0
                    force_odd_parity[x] = True
                elif is_p[y] and is_c[x]:
                    ty = 0.0
                    force_odd_parity[y] = True

            if (x, y) in rbond_vals:
                free_vals_temp[x] += rbond_vals[(x, y)] - tx
                free_vals_temp[y] += rbond_vals[(x, y)] - ty
            else:
                free_vals_temp[x] += -tx
                free_vals_temp[y] += -ty

        # too many connections? sulfur valence not even? phosphorous valence not odd?
        if (
            any(free_vals_temp < 0)
            or any(aval % 2 != 0 for aval in free_vals_temp[force_even_parity])
            or any(aval % 2 != 1 for aval in free_vals_temp[force_odd_parity])
        ):
            return False
        return True

    # N choose k combinatorics
    # up to 4 bond changes at once - only 0.19% of train examples have 5 bonds changed, we can take the hit...
    core_bonds_i = range(len(core_bonds))
    for k in range(1, kmax + 1):
        for bond_change_combo_i in itertools.combinations(core_bonds_i, k):
            # Check if connected
            if not check_if_connected(bond_change_combo_i):
                # print('This combination is not connected!')
                continue

            bond_change_combo = [core_bonds[i] for i in bond_change_combo_i]

            if check_if_valid(bond_change_combo):
                # if bond_change_combo_i == (0, 1):
                # print('VALID')
                core_configs.append(bond_change_combo)

    if not testing:
        random.shuffle(core_configs)
        idx = -1
        for i, cand_bonds in enumerate(core_configs):
            if set([(x, y, t) for (x, y, t, v) in cand_bonds]) == gold_bonds:
                idx = i
                break
        # print(idx)
        # If we are training and did not find the true outcome, make sure it is the first entry
        if idx == -1:
            # print('Did not find true outcome')
            found_true = False
            core_configs = [[(x, y, t, 0.0) for (x, y, t) in gold_bonds]] + core_configs
        else:
            # print('Found true outcome')
            found_true = True
            # swap order so true is first
            core_configs[0], core_configs[idx] = core_configs[idx], core_configs[0]
    else:
        found_true = False

    if not testing:
        # If it is possible to recover the true smiles from the set of bonds using the edit_mol method,
        # remove duplicates from the list by converting each candidate into a smiles string
        # note: get_product_smiles is HIGHLY imperfect, but that's not a huge deal. training tries to pick the
        #       right bonds. The evaluation script has a more robust function to get product_smiles
        smiles0 = get_product_smiles(mol, core_configs[0], tatoms)
        if len(smiles0) > 0:  #
            cand_smiles = {smiles0}
            new_core_configs = [core_configs[0]]

            for core_conf in core_configs[1:]:
                smiles = get_product_smiles(mol, core_conf, tatoms)
                # print('candidate smiles: {}'.format(smiles))
                if smiles in cand_smiles or len(smiles) == 0:
                    continue
                cand_smiles.add(smiles)
                new_core_configs.append(core_conf)
            core_configs = new_core_configs

        else:
            # TODO log instead of actually printing to out
            print(
                "\nwarning! could not recover true smiles from gbonds: {}".format(
                    psmiles
                )
            )
            print("{}    {}".format(rsmiles, gold_bonds))

    # print('After removing duplicates, {} core configs'.format(len(core_configs)))
    # print(core_configs)
    core_configs = core_configs[:cutoff]

    n_batch = len(core_configs) + 1
    if not testing:
        labels = np.zeros((n_batch - 1,))
        labels[0] = 1

    # Calculate information that is the same for all candidates; do small updates based on specific changes later
    pending_reactant_neighbors = []  # reactant neighbors that *might* be over-ridden
    core_bonds_no_score = [(x, y, t) for (x, y, t, z) in core_bonds]
    for bond in mol.GetBonds():
        idx = bond.GetIdx()
        a1 = idxfunc(bond.GetBeginAtom())
        a2 = idxfunc(bond.GetEndAtom())
        a1, a2 = min(a1, a2), max(a1, a2)

        if (a1, a2, 0.0) not in core_bonds_no_score:
            # are a1 and a2 guaranteed to be neighbors?
            raw_atom_nb[a1, raw_num_nbs[a1]] = a2
            raw_atom_nb[a2, raw_num_nbs[a2]] = a1
            raw_bond_nb[a1, raw_num_nbs[a1]] = idx
            raw_bond_nb[a2, raw_num_nbs[a2]] = idx
            raw_num_nbs[a1] += 1
            raw_num_nbs[a2] += 1
        else:
            pending_reactant_neighbors.append((a1, a2, bond.GetBondTypeAsDouble()))

        # Reactants have this bond...
        atom_nb[a1, num_nbs[a1]] = a2
        atom_nb[a2, num_nbs[a2]] = a1
        bond_nb[a1, num_nbs[a1]] = idx
        bond_nb[a2, num_nbs[a2]] = idx
        num_nbs[a1] += 1
        num_nbs[a2] += 1
        fbonds[idx] = bond_features(bond)

    # print('What is core_bonds here?: {}'.format(core_bonds))
    if not testing:
        # CC fixed in case where core_bonds isn't large enough
        num_newbonds = max(len(gold_bonds), len(core_bonds)) * 2 + 1
    else:
        num_newbonds = len(core_bonds) * 2 + 1
    # CC added + len(pending_reactant_neighbors)
    new_fbonds = np.zeros(
        (n_bonds + num_newbonds + len(pending_reactant_neighbors), bond_fdim)
    )
    new_fbonds[:n_bonds, :] = fbonds
    fbonds = new_fbonds
    batch_fbonds, batch_anb, batch_bnb, batch_nbs = (
        [fbonds],
        [atom_nb],
        [bond_nb],
        [num_nbs],
    )  # first entry is reactants
    batch_corebias = []
    for core_bonds in core_configs:
        atom_nb2 = np.copy(raw_atom_nb)
        bond_nb2 = np.copy(raw_bond_nb)
        num_nbs2 = np.copy(raw_num_nbs)
        fbonds2 = np.copy(fbonds)
        n_bonds2 = n_bonds + 1

        # Add back reactant bonds?
        core_bonds_nobo = [(x, y) for (x, y, t, v) in core_bonds]
        for (x, y, t) in pending_reactant_neighbors:
            if (x, y) not in core_bonds_nobo:
                core_bonds.append((x, y, t, 0.0))

        for x, y, t, v in core_bonds:
            # add new bond features to the "default" reactant ones
            if t == 0:
                continue

            atom_nb2[x, num_nbs2[x]] = y
            atom_nb2[y, num_nbs2[y]] = x
            bond_nb2[x, num_nbs2[x]] = n_bonds2
            bond_nb2[y, num_nbs2[y]] = n_bonds2
            num_nbs2[x] += 1
            num_nbs2[y] += 1
            fbonds2[n_bonds2] = onek_encoding_unk(t, [1.0, 2.0, 3.0, 1.5, -1])
            if (x, y) in ring_bonds:
                fbonds2[n_bonds2][4] = 1
            n_bonds2 += 1

        batch_fbonds.append(fbonds2)
        batch_anb.append(atom_nb2)
        batch_bnb.append(bond_nb2)
        batch_nbs.append(num_nbs2)
        batch_corebias.append(sum([v for (x, y, t, v) in core_bonds]))

    # TODO: change atom features for each candidate? Maybe update degree at least

    if not testing:
        graph_inputs = (
            np.array([fatoms] * n_batch),
            np.array(batch_fbonds),
            pack2D_withidx(batch_anb),
            pack2D_withidx(batch_bnb),
            np.array(batch_nbs),
            np.array(batch_corebias),
            labels,
        )
    else:
        graph_inputs = (
            np.array([fatoms] * n_batch),
            np.array(batch_fbonds),
            pack2D_withidx(batch_anb),
            pack2D_withidx(batch_bnb),
            np.array(batch_nbs),
            np.array(batch_corebias),
        )

    if return_found:
        return graph_inputs, core_configs, found_true
    else:
        return graph_inputs, core_configs
