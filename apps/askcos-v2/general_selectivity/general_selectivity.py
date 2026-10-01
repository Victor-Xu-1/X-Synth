import tensorflow as tf
import pandas as pd
import numpy as np
import os
from rdkit import Chem
from scipy.special import softmax
from template_extractor import extract_from_reaction
from rdchiral.initialization import rdchiralReactants, rdchiralReaction
from rdchiral.main import rdchiralRun
import global_config as gc
from general_model.data_loading import (
    gnn_data_generation,
    qm_gnn_data_generation,
)
from general_model.loss import wln_loss
from general_model.models import WLNReactionClassifier
from general_model.qm_models import (
    QMWLNPairwiseAtomClassifier,
    WLNPairwiseAtomClassifierNoReagent,
)
import parsing
from api.atom_map_api import AtomMapAPI
from api.descriptors_api import DescriptorsAPI

GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://0.0.0.0:9100")
atom_mapper = AtomMapAPI(
    url=f"{GATEWAY_URL}/api/atom-map/call-sync",
    backend="wln"
)
descriptor_predictor = DescriptorsAPI(
    url=f"{GATEWAY_URL}/api/descriptors/call-sync"
)

GNN_model_path = gc.GEN_SELECTIVITY["model_path"]["GNN"]
QM_GNN_model_path = gc.GEN_SELECTIVITY["model_path"]["QM_GNN"]
QM_GNN_no_reagent_model_path = gc.GEN_SELECTIVITY["model_path"]["QM_GNN_no_reagent"]
scaler_path = gc.GEN_SELECTIVITY["scalers"]

initializer = "[CH4:1]>ClC(Cl)Cl>[CH4:1]"
initializer_qm_descriptors = {
    "[CH4:1]": {
        "partial_charge": [0.2840435, 0.42871496, 0.42871496, 0.42871496, 0.42871493],
        "fukui_neu": [0.40352857, 0.27556148, 0.27556148, 0.27556148, 0.27556148],
        "fukui_elec": [0.69178367, 0.3259021, 0.3259021, 0.3259021, 0.3259021],
        "NMR": [1.7733233, 0.705616, 0.705616, 0.7056161, 0.7056161],
        "bond_order_matrix": [
            [0, 0.94360828, 0.94360828, 0.94360828, 0.94360828],
            [0.94360828, 0, 0, 0, 0],
            [0.94360828, 0, 0, 0, 0],
            [0.94360828, 0, 0, 0, 0],
            [0.94360828, 0, 0, 0, 0],
        ],
        "distance_matrix": [
            [0, 1.0847981, 1.0847981, 1.0847981, 1.0847981],
            [1.0847981, 0, 0, 0, 0],
            [1.0847981, 0, 0, 0, 0],
            [1.0847981, 0, 0, 0, 0],
            [1.0847981, 0, 0, 0, 0],
        ],
    }
}

GLOBAL_SCALE = ["partial_charge", "fukui_neu", "fukui_elec"]
ATOM_SCALE = ["NMR"]


def _bond_to_matrix(smiles, bond_vector):
    m = Chem.MolFromSmiles(smiles)

    m = Chem.AddHs(m)

    bond_matrix = np.zeros([len(m.GetAtoms()), len(m.GetAtoms())])
    for i, bp in enumerate(bond_vector):
        b = m.GetBondWithIdx(i)
        bond_matrix[b.GetBeginAtomIdx(), b.GetEndAtomIdx()] = bond_matrix[
            b.GetEndAtomIdx(), b.GetBeginAtomIdx()
        ] = bp

    return bond_matrix


def _min_max_normalize(df, scalers):

    df = pd.DataFrame(df).applymap(np.array)

    for column in GLOBAL_SCALE:
        scaler = scalers[column]
        df[column] = df[column].apply(
            lambda x: scaler.transform(x.reshape(-1, 1)).reshape(-1)
        )

    def _min_max_by_atom(atoms, data, scaler):
        data = [scaler[a].transform(np.array([[d]]))[0][0] for a, d in zip(atoms, data)]
        return np.array(data)

    if ATOM_SCALE:
        print("postprocessing atom-wise scaling")
        df["atoms"] = df.smiles.apply(lambda x: _get_atoms(x))
        for column in ATOM_SCALE:
            df[column] = df.apply(
                lambda x: _min_max_by_atom(x["atoms"], x[column], scalers[column]),
                axis=1,
            )

    df["bond_order_matrix"] = df.apply(
        lambda x: _bond_to_matrix(x["smiles"], x["bond_order"]), axis=1
    )
    df["distance_matrix"] = df.apply(
        lambda x: _bond_to_matrix(x["smiles"], x["bond_length"]), axis=1
    )

    df = df[
        [
            "smiles",
            "partial_charge",
            "fukui_neu",
            "fukui_elec",
            "NMR",
            "bond_order_matrix",
            "distance_matrix",
        ]
    ].set_index("smiles")

    df = df.applymap(lambda x: x.tolist()).T.to_dict()

    return df


def _get_atoms(smiles):
    m = Chem.MolFromSmiles(smiles)

    m = Chem.AddHs(m)

    atoms = [x.GetSymbol() for x in m.GetAtoms()]

    return atoms


def apply_template(template, rxn_smiles):

    rt, _, pt = template.split(">")
    template = "({0})>>({1})".format(rt, pt)
    r, rg, p = rxn_smiles.split(">")
    precursor = rdchiralReactants(r)
    forward_rxn = rdchiralReaction(str(template))

    outcomes = rdchiralRun(forward_rxn, precursor, return_mapped=True)
    outcomes = list([x[0] for x in outcomes[1].values()])

    try:
        reactants = precursor.smiles()  # rdchiral_cpp
    except AttributeError:
        # Python version of rdchiral
        reactants = Chem.MolToSmiles(precursor.reactants)

    product_atom_count = Chem.MolFromSmiles(p).GetNumHeavyAtoms()
    new_outcomes = [
        x
        for x in outcomes
        if Chem.MolFromSmiles(x).GetNumHeavyAtoms() == product_atom_count
    ]

    return ">".join([reactants, rg, ".".join(new_outcomes)])


class GeneralSelectivityPredictor:
    def __init__(self):
        self.atom_mapper = atom_mapper
        self.descriptor_predictor = descriptor_predictor

        self.qm_scaler = pd.read_pickle(scaler_path)
        self.model = None
        self.build()

    def _initialize_model(self, initializer_x):
        opt = tf.keras.optimizers.Adam(lr=0.001, clipnorm=5.0)
        self.model.compile(
            optimizer=opt,
            loss=wln_loss,
        )
        self.model.predict_on_batch(initializer_x)

    def build(self):
        raise NotImplementedError

    def reference(self, rxnsmiles):
        raise NotImplementedError

    def predict(
        self,
        rxnsmiles,
        atom_map_backend: str = "wln",
        mapped=False,
        all_outcomes=False,
        verbose=True,
        no_map_reagents=False,
    ):
        if not mapped:
            rsmi, rgsmi, psmi = rxnsmiles.split(">")

            if no_map_reagents:
                rsmi_am, _, psmi_am = self.atom_mapper(
                    smiles=[rsmi + ">>" + psmi],
                    backend=atom_map_backend
                )[0].split(">")
            else:
                rsmi_am, rgsmi, psmi_am = self.atom_mapper(
                    smiles=[rxnsmiles],
                    backend=atom_map_backend
                )[0].split(">")

            if rsmi_am and psmi_am:
                rxnsmiles = ">".join([rsmi_am, rgsmi, psmi_am])
            else:
                raise RuntimeError(
                    "Failed to map the given reaction smiles with the "
                    "selected mapping method, please select other mapping methods."
                )

        if not all_outcomes:
            rsmi, _, psmi = rxnsmiles.split(">")
            reaction = {"reactants": rsmi, "products": psmi, "_id": 0}
            try:
                template = extract_from_reaction(reaction)
                rxnsmiles = apply_template(template, rxnsmiles)
            except Exception:
                raise RuntimeError(
                    "Failed to extract or apply reaction template for the given "
                    "reaction. Please examine your reaction in the atom mapping app."
                )

        if len(rxnsmiles.split(">")[2].split(".")) <= 1:
            raise ValueError(
                "Regioselectivity is not applicable for the given reaction."
            )

        selectivity = self.reference(rxnsmiles)

        _, _, products = rxnsmiles.split(">")
        products = [parsing.canonicalize_mapped_smiles(s) for s in products.split(".")]

        if verbose:
            selectivity, products = zip(
                *sorted(zip(selectivity, products), reverse=True)
            )
            results = [
                {"smiles": prod, "prob": prob, "rank": i + 1}
                for i, (prod, prob) in enumerate(zip(products, selectivity))
            ]
        else:
            results = selectivity

        return results


class GnnGeneralSelectivityPredictor(GeneralSelectivityPredictor):
    def build(self):
        model_path = GNN_model_path

        self.model = WLNReactionClassifier()
        initializer_x = gnn_data_generation(
            initializer.split(">")[0], initializer.split(">")[2]
        )
        self._initialize_model(initializer_x)
        self.model.load_weights(model_path)

    def reference(self, rxnsmiles):
        reactants, _, products = rxnsmiles.split(">")
        test_gen = gnn_data_generation(reactants, products)

        out = self.model.predict_on_batch(test_gen).reshape([-1])
        out = tuple([float(x) for x in softmax(out)])
        return out


class QmGnnGeneralSelectivityPredictor(GeneralSelectivityPredictor):
    def build(self):
        model_path = QM_GNN_model_path
        initializer_x = qm_gnn_data_generation(
            initializer.split(">")[0],
            initializer.split(">")[2],
            initializer.split(">")[1],
            initializer_qm_descriptors,
        )
        self.model = QMWLNPairwiseAtomClassifier()
        self._initialize_model(initializer_x)

        print("Loading QM-GNN-Reagent selectivity model")
        self.model.summary()
        self.model.load_weights(model_path)

    def reference(self, rxnsmiles):
        reactants, reagent, products = rxnsmiles.split(">")
        rsmis = reactants.split(".")

        descriptors = []
        for rsmi in rsmis:
            res = self.descriptor_predictor(smiles=str(rsmi))
            descriptors.append(res)

        qm_df = _min_max_normalize(descriptors, self.qm_scaler)
        test_gen = qm_gnn_data_generation(reactants, products, reagent, qm_df)

        out = self.model.predict_on_batch(test_gen).reshape([-1])
        out = tuple([float(x) for x in softmax(out)])
        return out


class QmGnnGeneralSelectivityPredictorNoReagent(QmGnnGeneralSelectivityPredictor):
    def build(self):
        model_path = QM_GNN_no_reagent_model_path
        initializer_x = qm_gnn_data_generation(
            initializer.split(">")[0],
            initializer.split(">")[2],
            initializer.split(">")[1],
            initializer_qm_descriptors,
        )
        self.model = WLNPairwiseAtomClassifierNoReagent()
        self._initialize_model(initializer_x)

        print("Loading QM-GNN-No-Reagent selectivity model")
        self.model.summary()
        self.model.load_weights(model_path)
