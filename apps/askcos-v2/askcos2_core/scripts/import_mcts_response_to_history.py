import argparse
import json
from pathlib import Path

from configs import db_config
from pymongo import MongoClient
from tree_search_history_import import build_saved_result_document_from_mcts_response


def parse_args():
    parser = argparse.ArgumentParser(
        description="Import a real MCTS /get_buyable_paths response into ASKCOS result history."
    )
    parser.add_argument("--response-file", required=True, help="Path to the raw MCTS response JSON.")
    parser.add_argument("--user", required=True, help="ASKCOS username that should own the imported history item.")
    parser.add_argument("--target-smiles", required=True, help="Target SMILES for the history item.")
    parser.add_argument("--description", default="", help="History item description.")
    parser.add_argument("--source", default="direct_mcts", help="Provenance label stored in settings.history_import.")
    parser.add_argument("--share-with", action="append", default=[], help="Additional user allowed to see this item.")
    parser.add_argument("--public", action="store_true", help="Mark the item public.")
    return parser.parse_args()


def main():
    args = parse_args()
    response_path = Path(args.response_file)
    response = json.loads(response_path.read_text(encoding="utf-8"))
    description = args.description or f"Imported direct MCTS result: {args.target_smiles}"

    doc = build_saved_result_document_from_mcts_response(
        response=response,
        user=args.user,
        target_smiles=args.target_smiles,
        description=description,
        source=args.source,
        settings={
            "history_import": {
                "source_file": str(response_path),
            }
        },
    )
    doc["public"] = bool(args.public)
    doc["shared_with"] = sorted({args.user, *args.share_with})

    client = MongoClient(serverSelectionTimeoutMS=1000, **db_config.MONGO)
    collection = client["results"]["results"]
    collection.insert_one(doc)
    print(json.dumps({
        "result_id": doc["result_id"],
        "user": doc["user"],
        "target_smiles": doc["target_smiles"],
        "num_trees": doc["num_trees"],
        "result_state": doc["result_state"],
    }, ensure_ascii=True))


if __name__ == "__main__":
    main()
