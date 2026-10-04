"""Verified offline RXNMapper assets and actual upstream model readiness."""

import base64
import hashlib
import importlib.metadata
import importlib.util
import json
import os
import sys
from pathlib import Path
from urllib import parse, request

from packages.adapters.askcos.forward import ForwardAdapter
from packages.adapters.askcos.impurities import (
    RANKING_STRATEGY,
    RXNMAPPER_VERSION,
    RXNMAPPER_WHEEL_SHA256,
    ImpurityInput,
    ImpurityProvenance,
    validate_mapping,
)
from packages.adapters.askcos.native_models import NativeModelError
from packages.adapters.askcos.transport import NoRedirect
from packages.chemistry.forward_evaluation import validate_forward_input
from packages.platform.performance import PerformanceBudget
from packages.workspace.structure_validation import canonical_structure

SOURCE = Path(__file__).with_name("impurity_predictor.py")
MAPPER_MODEL_PATH = "rxnmapper/models/transformers/albert_heads_8_uspto_all_1310k"


def configured_model_threads():
    return PerformanceBudget.from_environment().model_threads


MAPPER_ASSET_HASHES = {
    "config.json": "ea0f3144af1d13a5d5928cff01abd8e7c14ab831ff7b6d73a14d4162864a876f",
    "pytorch_model.bin": "8541f3f500dae71abe678d546bd035ca946e2d1c819f6b2cf41a97faedd7e6a2",
    "special_tokens_map.json": "303df45a03609e4ead04bc3dc1536d0ab19b5358db685b6f3da123d05ec200e3",
    "tokenizer_config.json": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    "training_args.bin": "440fdf4459c2f51c3f042ccad777342b06bf3f491c251b712ab2aada5ff7a2eb",
    "vocab.txt": "399868a653e85549ce150af4a1f6cd2776240c6a3d951ced2120565f00f027fd",
}


def _hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_mapper_assets(distribution):
    expected = {f"{MAPPER_MODEL_PATH}/{name}" for name in MAPPER_ASSET_HASHES}
    files = [
        item
        for item in distribution.files or []
        if str(item).startswith(MAPPER_MODEL_PATH + "/")
    ]
    if len(files) != len(expected) or {str(item) for item in files} != expected:
        raise ValueError(
            "The official bundled RXNMapper model RECORD is incomplete or unexpected."
        )
    root = Path(distribution.locate_file("")).resolve(strict=True)
    asset_path = root
    for part in MAPPER_MODEL_PATH.split("/"):
        child = asset_path / part
        if (
            child.is_symlink()
            or not child.is_dir()
            or child.resolve(strict=True).parent != asset_path
        ):
            raise ValueError(
                "RXNMapper assets must stay in the verified distribution without symlinks."
            )
        asset_path = child.resolve(strict=True)
    entries = list(asset_path.iterdir())
    if {entry.name for entry in entries} != set(MAPPER_ASSET_HASHES):
        raise ValueError("RXNMapper model directory contains missing or extra entries.")
    for entry in entries:
        if (
            entry.is_symlink()
            or not entry.is_file()
            or entry.resolve(strict=True).parent != asset_path
        ):
            raise ValueError(
                "RXNMapper assets must be regular nonsymlink files in the verified model directory."
            )
    digest = hashlib.sha256()
    for item in sorted(files, key=str):
        path = Path(distribution.locate_file(item))
        if path.resolve(strict=True).parent != asset_path:
            raise ValueError("RXNMapper model RECORD escapes the verified directory.")
        actual = hashlib.sha256(path.read_bytes()).digest()
        if actual.hex() != MAPPER_ASSET_HASHES[path.name]:
            raise ValueError(
                "RXNMapper model assets differ from the verified official 0.4.3 wheel."
            )
        if (
            item.hash is None
            or item.hash.mode != "sha256"
            or base64.urlsafe_b64encode(actual).decode().rstrip("=") != item.hash.value
        ):
            raise ValueError(
                "Bundled RXNMapper assets do not match the installed wheel RECORD."
            )
        digest.update(str(item).encode())
        digest.update(actual)
    return asset_path, digest.hexdigest()


def _load_offline_mapper(asset_path):
    from rxnmapper import RXNMapper
    from rxnmapper.tokenization_smiles import SmilesTokenizer
    from transformers import AlbertModel

    class OfflineRXNMapper(RXNMapper):
        def _load_model_and_tokenizer(self):
            if (
                self.model_type != "albert"
                or Path(self.model_path).resolve() != asset_path
            ):
                raise ValueError("Only the verified bundled ALBERT model is supported.")
            model = AlbertModel.from_pretrained(
                str(asset_path),
                local_files_only=True,
                trust_remote_code=False,
                weights_only=True,
                use_safetensors=False,
                attn_implementation="eager",
                output_attentions=True,
                output_past=False,
                output_hidden_states=False,
            )
            tokenizer = SmilesTokenizer(
                str(asset_path / "vocab.txt"),
                max_len=model.config.max_position_embeddings,
            )
            return model, tokenizer

    return OfflineRXNMapper(
        config={"model_path": str(asset_path), "model_type": "albert"}
    )


def service_ready(url, expected_model):
    parsed = parse.urlsplit(url)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.path not in {"", "/"}
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Native impurity dependencies must use loopback HTTP.")
    opener = request.build_opener(request.ProxyHandler({}), NoRedirect())
    with opener.open(url.rstrip("/") + "/health/ready", timeout=3) as response:
        body = json.loads(response.read(8193))
    if body.get("status") != "ready" or body.get("model") != expected_model:
        raise ValueError("An impurity model dependency is not ready.")
    return body


def load_models():
    threads = configured_model_threads()
    os.environ.update(
        {
            "OMP_NUM_THREADS": str(threads),
            "MKL_NUM_THREADS": str(threads),
            "OPENBLAS_NUM_THREADS": str(threads),
            "CUDA_VISIBLE_DEVICES": "",
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "HF_HUB_DISABLE_IMPLICIT_TOKEN": "1",
        }
    )
    import torch

    torch.set_num_threads(threads)
    torch.set_num_interop_threads(1)
    if importlib.metadata.version("rxnmapper") != RXNMAPPER_VERSION:
        raise ValueError("Unsupported RXNMapper package version.")
    distribution = importlib.metadata.distribution("rxnmapper")
    asset_path, asset_identity = verify_mapper_assets(distribution)
    mapper = _load_offline_mapper(asset_path)
    if mapper.device.type != "cpu":
        raise ValueError("Impurity atom mapping must use CPU.")
    # Actual mapping warmup, not a prediction or experimental benchmark.
    probe = mapper.get_attention_guided_atom_maps(["CC(=O)Cl.CN>>CNC(C)=O"])[0]
    validate_mapping(
        canonical_structure("CC(=O)Cl.CN")[0],
        "CNC(C)=O",
        probe["mapped_rxn"],
        probe["confidence"],
    )
    forward_url = os.environ.get("X_SYNTH_FORWARD_URL", "http://127.0.0.1:9911")
    filter_url = os.environ.get("X_SYNTH_FAST_FILTER_URL", "http://127.0.0.1:9611")
    forward = service_ready(forward_url, "graph2smiles_uspto_stereo")
    service_ready(filter_url, "askcos_fast_filter")
    provenance = ImpurityProvenance(
        algorithm_source_sha256=_hash(SOURCE),
        integration_source_sha256=hashlib.sha256(
            b"\0".join(
                [
                    SOURCE.with_name(name).read_bytes()
                    for name in [
                        "native_server.py",
                        "native_mapper.py",
                        "native_session.py",
                        "native_runtime.py",
                    ]
                ]
                + [
                    Path(module.__file__).read_bytes()
                    for module in [
                        sys.modules[ImpurityInput.__module__],
                        sys.modules[ForwardAdapter.__module__],
                        sys.modules[validate_forward_input.__module__],
                        sys.modules[NativeModelError.__module__],
                    ]
                ]
            )
        ).hexdigest(),
        forward_model="graph2smiles_uspto_stereo",
        forward_asset_identity=forward["asset_identity"],
        fast_filter_model="askcos_fast_filter",
        mapper_model="rxnmapper_albert_uspto_all_1310k",
        mapper_asset_identity=asset_identity,
        mapper_package_version=RXNMAPPER_VERSION,
        mapper_wheel_sha256=RXNMAPPER_WHEEL_SHA256,
        mapper_license="MIT",
        mapper_reference_url="https://doi.org/10.1126/sciadv.abe4166",
        versions={
            name: importlib.metadata.version(name)
            for name in [
                "rxnmapper",
                "torch",
                "transformers",
                "rdkit",
                "rxn-chem-utils",
            ]
        },
        ranking_strategy=RANKING_STRATEGY,
    )
    sys.path.insert(0, str(SOURCE.parent))
    spec = importlib.util.spec_from_file_location("_askcos_original_impurity", SOURCE)
    legacy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(legacy)
    return (
        mapper,
        ForwardAdapter(forward_url, filter_url),
        legacy.ImpurityPredictor,
        provenance,
    )
