import importlib.util
import pickle
from pathlib import Path

import pytest
from pydantic import ValidationError

from packages.adapters.askcos.conditions import ConditionResult, ingredient_identity
from packages.adapters.askcos.forward import RankedPrediction
from packages.adapters.askcos.native_models import NativeModelClient
from packages.chemistry.forward_evaluation import atom_inventory, product_uses_supplied_atoms, validate_forward_input
from packages.platform.native_runtime import NativeRuntime, SERVICES


ROOT = Path(__file__).resolve().parents[2]


def load_source(relative, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("url", ["file:///tmp/model", "http://user:secret@localhost", "http://localhost/private",
                               "http://localhost?target=private", "http://localhost#fragment"])
def test_native_model_url_rejects_credential_and_path_channels(url):
    with pytest.raises(ValueError, match="URL"):
        NativeModelClient(url)


def test_native_model_path_allowlist_precedes_transport():
    with pytest.raises(ValueError, match="operation"):
        NativeModelClient("http://127.0.0.1:1").post("/../private", {})


def test_forward_inventory_preserves_isotopes_and_blocks_unsupplied_atoms():
    assert product_uses_supplied_atoms("CC(=O)Cl.NCc1ccccc1", "CC(=O)NCc1ccccc1")
    assert not product_uses_supplied_atoms("CC(=O)O.CCCO", "CCCOC(=O)C=Cc1ccccc1")
    assert not product_uses_supplied_atoms("CCO", "[13CH3]CO")
    assert not product_uses_supplied_atoms("CCO", "[2H]OCC")
    assert product_uses_supplied_atoms("[2H]OCC", "[2H]OCC")
    assert atom_inventory("[13CH3][C@H](O)[NH3+].[Cl-]")[(6, 13)] == 1
    with pytest.raises(ValueError):
        atom_inventory("not a molecule")


def test_forward_validation_cannot_reach_upstream_dummy_ethane_substitution():
    assert validate_forward_input("O=C(N)c1ccccc1") == "NC(=O)c1ccccc1"
    for value in ["Cl", "[Na+].[Cl-]", "*CC"]:
        with pytest.raises(ValueError):
            validate_forward_input(value)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -0.1, 1.1])
def test_independent_feasibility_values_are_finite_and_bounded(value):
    with pytest.raises(ValidationError):
        RankedPrediction(product="CCO", log_probability=-2.5, feasibility_score=value)


def test_conditions_result_rejects_nan_and_oversized_output():
    base = dict(reactants="CCO", product="CC=O", model="nn_v1", asset_identity="a" * 64,
                evidence_type="model_prediction")
    condition = dict(temperature=25, solvent="O", reagent="", catalyst="", score=0.5)
    with pytest.raises(ValidationError):
        ConditionResult(**base, conditions=[{**condition, "temperature": float("nan")}])
    with pytest.raises(ValidationError):
        ConditionResult(**base, conditions=[condition] * 21)


def test_model_labels_are_not_misrepresented_as_structure_images():
    assert ingredient_identity("").status == "not_predicted"
    record = ingredient_identity("Reaxys Name Petroleum ether")
    assert record.status == "label_only" and record.smiles is None
    assert record.label == "Reaxys Name Petroleum ether"
    structured = ingredient_identity("[13CH3][O-].[Na+]")
    assert structured.status == "structure" and "[13CH3]" in structured.smiles


def test_condition_label_reader_accepts_only_primitive_integer_string_maps(tmp_path):
    assets = load_source("apps/askcos-v2/context_recommender/app/common/services/model_assets.py", "condition_asset_validation")
    good = tmp_path / "labels.pickle"
    good.write_bytes(pickle.dumps({0: "", 1: "CCO"}))
    assert assets.load_labels(good) == {0: "", 1: "CCO"}
    good.write_bytes(pickle.dumps({"0": "CCO"}))
    with pytest.raises(ValueError):
        assets.load_labels(good)
    good.write_bytes(b"cos\nsystem\n(S'echo unauthorized'\ntR.")
    with pytest.raises(pickle.UnpicklingError):
        assets.load_labels(good)


def test_optional_service_availability_uses_both_runtime_and_verified_asset(tmp_path):
    runtime = NativeRuntime.__new__(NativeRuntime)
    runtime.assets = tmp_path
    runtime.python = tmp_path / "native-python"
    assert runtime._service_available("fast_filter")
    assert not runtime._service_available("condition_recommender")
    service = SERVICES["condition_recommender"]
    python = tmp_path / service.python_asset
    manifest = tmp_path / service.required_asset
    python.parent.mkdir(parents=True)
    python.touch()
    assert not runtime._service_available("condition_recommender")
    manifest.parent.mkdir(parents=True)
    manifest.write_text("{}")
    assert runtime._service_available("condition_recommender")


@pytest.mark.parametrize("name", ["condition_recommender", "forward_predictor", "impurity"])
def test_scientific_services_do_not_inherit_credentials_or_proxy_controls(name, tmp_path):
    runtime = NativeRuntime.__new__(NativeRuntime)
    runtime.state = tmp_path.resolve()
    runtime.environment = {
        "PATH": "/usr/bin", "HOME": "/home/chemist", "PYTHONPATH": "/source",
        "ASKCOS_DATA_DIR": "/assets", "X_SYNTH_MODEL_THREADS": "2",
        "MONGO_PW": "not-a-real-password", "OPENAI_API_KEY": "not-a-real-key",
        "HF_TOKEN": "not-a-real-token", "HTTP_PROXY": "http://untrusted.invalid",
    }
    environment = runtime._service_environment(name)
    assert environment["X_SYNTH_MODEL_THREADS"] == "2"
    assert environment["ASKCOS_DATA_DIR"] == "/assets"
    assert environment["HF_HUB_DISABLE_IMPLICIT_TOKEN"] == "1"
    assert environment["HOME"] == str(tmp_path / "native/model-home" / name)
    assert environment["PYTHONNOUSERSITE"] == "1"
    assert (tmp_path / "native/model-home" / name).stat().st_mode & 0o777 == 0o700
    assert not {"MONGO_PW", "OPENAI_API_KEY", "HF_TOKEN", "HTTP_PROXY"} & environment.keys()


def test_gateway_retains_only_its_existing_operator_environment_contract():
    runtime = NativeRuntime.__new__(NativeRuntime)
    runtime.environment = {"MONGO_PW": "not-a-real-password"}
    assert runtime._service_environment("gateway")["MONGO_PW"] == "not-a-real-password"


def test_scientific_private_home_cannot_redirect_outside_state(tmp_path):
    runtime = NativeRuntime.__new__(NativeRuntime)
    runtime.state = tmp_path / "state"
    runtime.environment = {}
    home = runtime.state / "native/model-home/impurity"
    home.parent.mkdir(parents=True)
    home.symlink_to(tmp_path / "other", target_is_directory=True)
    with pytest.raises(ValueError, match="HOME"):
        runtime._service_environment("impurity")


def test_graph_distances_preserve_disconnection_without_shared_binary():
    pytest.importorskip("scipy", reason="This distance check also runs in the isolated native inference environment")
    import numpy as np
    distance = load_source("apps/askcos-v2/forward_predictor/graph2smiles/utils/ctypes_calculator.py", "forward_distance_calculator")
    adjacency = np.array([[0, 1, 0, 0], [1, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 0]], dtype=bool)
    assert distance.DistanceCalculator.calculate(adjacency, 4, 4).tolist() == [
        [0, 1, 2, 0], [1, 0, 1, 0], [2, 1, 0, 0], [0, 0, 0, 0],
    ]


@pytest.mark.parametrize("reactants", [
    "[H][H]",
    "[13CH3][C@H](O)[NH3+].[Cl-].OCCBr.OCCBr",
])
def test_native_forward_preprocessing_preserves_real_features_without_logging_input(
    reactants, monkeypatch, capfd, caplog
):
    import argparse
    import logging
    from multiprocessing.pool import ThreadPool

    torch = pytest.importorskip("torch", reason="Also verified in the native inference environment")
    pytest.importorskip("scipy", reason="Native graph distance calculation requires scipy")
    directory = ROOT / "apps/askcos-v2/forward_predictor/graph2smiles"
    monkeypatch.syspath_prepend(str(directory))
    handler_module = load_source(str(directory.relative_to(ROOT) / "handler.py"), "private_forward_handler")
    from utils.ctypes_calculator import DistanceCalculator
    from utils.data_utils import canonicalize_smiles, collate_graph_features
    from utils.preprocess_utils import get_graph_features_from_smi

    expected = canonicalize_smiles(validate_forward_input(reactants), trim=False, suppress_warning=True)
    features = get_graph_features_from_smi((0, expected))
    graph = (features[0], features[2], features[4], features[6], features[8], features[9])
    expected_nodes = collate_graph_features([graph])[0]
    handler = handler_module.G2SHandler()
    handler.args = argparse.Namespace(
        mask_rel_chirality=0, predict_batch_size=16384,
        task="reaction_prediction", rel_pos_buckets=11,
    )
    handler.distance_calculator = DistanceCalculator()
    with ThreadPool(processes=1) as pool, caplog.at_level(logging.DEBUG):
        handler.p = pool
        batches = handler.preprocess([{"body": {"smiles": [reactants]}}])
    assert len(batches) == 1 and torch.equal(batches[0].fnode, expected_nodes)
    output = capfd.readouterr()
    assert reactants not in output.out + output.err + caplog.text
    assert expected not in output.out + output.err + caplog.text


@pytest.mark.parametrize("reactants", ["", "Cl", "[Na+].[Cl-]", "*CC", "invalid_private_structure"])
def test_native_forward_preprocessing_rejects_dummy_replacements_before_featurization(
    reactants, capfd
):
    pytest.importorskip("torch", reason="Also verified in the native inference environment")
    handler_module = load_source(
        "apps/askcos-v2/forward_predictor/graph2smiles/handler.py", "strict_forward_handler"
    )
    handler = handler_module.G2SHandler()
    with pytest.raises(ValueError):
        handler.preprocess([{"body": {"smiles": [reactants]}}])
    output = capfd.readouterr()
    assert not output.out and not output.err


def test_native_forward_prediction_parse_suppresses_structure_warnings(monkeypatch, capfd):
    from rdkit import rdBase

    pytest.importorskip("torch", reason="Also verified in the native inference environment")
    monkeypatch.syspath_prepend(str(ROOT / "apps/askcos-v2/forward_predictor/graph2smiles"))
    from utils.data_utils import canonicalize_smiles

    private_prediction = "invalid_private_prediction"
    errors_enabled = "rdApp.error:enabled" in rdBase.LogStatus()
    rdBase.EnableLog("rdApp.error")
    try:
        assert canonicalize_smiles(private_prediction, trim=False, suppress_warning=True) == ""
        output = capfd.readouterr()
        assert not output.out and not output.err
        assert "rdApp.error:enabled" in rdBase.LogStatus()
        assert canonicalize_smiles(private_prediction, trim=False, suppress_warning=False) == ""
        assert private_prediction in capfd.readouterr().err
    finally:
        if not errors_enabled:
            rdBase.DisableLog("rdApp.error")
