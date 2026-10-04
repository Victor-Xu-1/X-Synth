"""Native Graph2SMILES inference using verified weights and local source code."""

import argparse
import hashlib
import json
from multiprocessing.pool import ThreadPool
from pathlib import Path

import torch

from handler import G2SHandler
from models.graph2smiles import Graph2SMILES
from predict import get_predict_parser
from train import get_model
from utils.ctypes_calculator import DistanceCalculator
from utils.data_utils import load_vocab


class Graph2SmilesRuntime(G2SHandler):
    def load(self, directory):
        directory = Path(directory)
        manifest = json.loads((directory / "asset.json").read_text(encoding="utf-8"))
        if set(manifest.get("files", {})) != {"model.pt", "vocab.txt"}:
            raise ValueError("Incomplete Graph2SMILES snapshot")
        for name, expected in manifest["files"].items():
            path = directory / name
            if path.is_symlink() or not path.is_file():
                raise ValueError("Invalid Graph2SMILES asset")
            with path.open("rb") as handle:
                digest = hashlib.file_digest(handle, "sha256").hexdigest()
            if digest != expected:
                raise ValueError("Graph2SMILES asset checksum mismatch")
        self.identity = manifest["archive_sha256"]
        self.device = torch.device("cpu")
        self.args, _ = get_predict_parser().parse_known_args([])
        self.overwrite_default_args()
        self.args.processed_data_path = str(directory)
        with torch.serialization.safe_globals([argparse.Namespace]):
            checkpoint = torch.load(directory / "model.pt", map_location=self.device, weights_only=True)
        model_args = checkpoint["args"]
        model_args.load_from = None
        model_args.local_rank = -1
        if not hasattr(model_args, "shared_attention_layer"):
            model_args.shared_attention_layer = 0
        if not hasattr(model_args, "n_latent"):
            model_args.n_latent = 1
        self.args.rel_pos_buckets = model_args.rel_pos_buckets
        self.vocab = load_vocab(self.args)
        self.vocab_tokens = [key for key, value in sorted(self.vocab.items(), key=lambda pair: pair[1])]
        self.model, _ = get_model(model_args, Graph2SMILES, self.vocab, self.device)
        weights = {key.removeprefix("module."): value for key, value in checkpoint["state_dict"].items()}
        self.model.load_state_dict(weights)
        self.model.eval()
        self.distance_calculator = DistanceCalculator()
        self.p = ThreadPool(processes=1)
        self.initialized = True
        return self

    def predict(self, smiles):
        batch = self.preprocess([{"body": {"smiles": [smiles]}}])
        with torch.inference_mode():
            return self.inference(batch)[0]

    def close(self):
        if self.p:
            self.p.close()
            self.p.join()
