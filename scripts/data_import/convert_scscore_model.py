"""Convert a checksummed upstream legacy model into data-only NumPy weights."""
from __future__ import annotations

import argparse
import codecs
import hashlib
from pathlib import Path
import pickle

import numpy as np


class WeightUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        allowed = {
            ("numpy.core.multiarray", "_reconstruct"): np._core.multiarray._reconstruct,
            ("numpy", "ndarray"): np.ndarray,
            ("numpy", "dtype"): np.dtype,
            ("_codecs", "encode"): codecs.encode,
        }
        if (module, name) not in allowed:
            raise pickle.UnpicklingError("Non-weight object in SCScore archive")
        return allowed[module, name]


def convert(source: Path, output: Path, expected_sha256: str):
    if output.exists():
        raise FileExistsError("Model snapshots are immutable")
    with source.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != expected_sha256.lower():
            raise ValueError("SCScore source checksum mismatch")
        stream.seek(0)
        weights = WeightUnpickler(stream, encoding="bytes").load()
    if not isinstance(weights, list) or len(weights) != 12:
        raise ValueError("Unexpected SCScore network layers")
    previous = 1024
    arrays = {}
    for index in range(0, len(weights), 2):
        matrix, bias = weights[index:index + 2]
        if not isinstance(matrix, np.ndarray) or not isinstance(bias, np.ndarray):
            raise ValueError("Non-array SCScore weight")
        if matrix.ndim != 2 or matrix.shape[0] != previous or bias.shape != (matrix.shape[1],):
            raise ValueError("SCScore layer dimensions do not match")
        if not np.isfinite(matrix).all() or not np.isfinite(bias).all():
            raise ValueError("Invalid SCScore weights")
        previous = matrix.shape[1]
        arrays[f"weight_{index}"] = matrix
        arrays[f"weight_{index + 1}"] = bias
    if previous != 1:
        raise ValueError("SCScore output must be scalar")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("xb") as stream:
        np.savez_compressed(stream, **arrays)
    return {"source_sha256": expected_sha256, "layers": len(weights) // 2}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    args = parser.parse_args()
    print(convert(args.source, args.output, args.sha256))


if __name__ == "__main__":
    main()
