"""Explicit, dry-run-first recovery after a reviewed projection-only upgrade."""

import argparse
import json
from pathlib import Path

from packages.adapters.askcos.projection_recovery import recover_projection
from packages.adapters.stock.stock_index import StockIndex


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("old-source", "new-source", "assets", "stock", "state", "receipt-dir"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--strategy", choices=("mcts", "retro_star"), required=True)
    parser.add_argument("--pass-number", type=int, choices=(1, 2), required=True)
    parser.add_argument("--apply", action="store_true")
    arguments = vars(parser.parse_args())
    arguments["stock"] = StockIndex(arguments["stock"])
    print(json.dumps(recover_projection(**arguments), sort_keys=True))


if __name__ == "__main__":
    main()
