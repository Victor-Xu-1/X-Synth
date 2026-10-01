import argparse
import csv
import logging
import misc
import os
import random
import time
import templ_rel_parser
import traceback
from concurrent.futures import TimeoutError
from datetime import datetime
from pebble import ProcessPool
from rdkit import RDLogger
from templ_rel_preprocessor import get_tpl
from typing import Any, Dict, List, Tuple


def _extract_templates_debug(
    rxns: List[Dict[str, Any]],
    max_workers: int,
    template_set: str,
    partition: int = 1
) -> Tuple[
    List[Dict[str, Any]],
    Dict[str, Dict[str, Any]],
    int
]:
    _start = time.time()
    rxns_with_template = []
    templates = {}
    failed_count = 0

    num_per_partition = int(len(rxns) / partition)
    for partition_start in range(0, len(rxns), num_per_partition):
        logging.info(f"Processing partition starting {partition_start}..")

        with ProcessPool(max_workers=max_workers) as pool:
            # Using pebble to add timeout, as rdchiral could hang
            future = pool.map(
                get_tpl,
                enumerate(rxns[partition_start:partition_start+num_per_partition]),
                timeout=10
            )
            iterator = future.result()

            # The while True - try/except/StopIteration is just pebble signature
            while True:
                try:
                    i, rxn_with_template = next(iterator)
                    if i > 0 and i % 1000 == 0:
                        logging.info(f"Processing {i}th reaction, "
                                     f"elapsed time: {time.time() - _start: .0f} s")

                    rxn_id = rxn_with_template["id"]
                    canon_reaction_smarts = rxn_with_template["canon_reaction_smarts"]
                    intra_only = rxn_with_template["intra_only"]
                    dimer_only = rxn_with_template["dimer_only"]
                    if canon_reaction_smarts:
                        if canon_reaction_smarts in templates:
                            templates[canon_reaction_smarts]["count"] += 1
                            templates[canon_reaction_smarts]["references"].append(rxn_id)
                        else:
                            templates[canon_reaction_smarts] = {
                                "index": -1,    # placeholder, to be reset after sorting
                                "reaction_smarts": canon_reaction_smarts,
                                "count": 1,
                                "necessary_reagent": "",
                                "intra_only": intra_only,
                                "dimer_only": dimer_only,
                                "template_set": template_set,
                                "references": [rxn_id],
                                "attributes": {
                                    "ring_delta": 1.0,
                                    "chiral_delta": 0
                                },
                                "_id": "-1"     # placeholder, to be reset after sorting
                            }
                    else:
                        failed_count += 1
                except StopIteration:
                    break
                except TimeoutError as error:
                    logging.info(f"get_tpl() call took more than {error.args} seconds.")
                    failed_count += 1
                    rxn_with_template = rxns[i]
                    rxn_with_template["canon_reaction_smarts"] = ""
                except:
                    logging.info(f"Unknown error for getting template.")
                    logging.info(f"Traceback: {traceback.format_exc()}")

                    failed_count += 1
                    rxn_with_template = rxns[i]
                    rxn_with_template["canon_reaction_smarts"] = ""

                rxns_with_template.append(rxn_with_template)

        # pool.close()
        # pool.join()

    return rxns_with_template, templates, failed_count

def debug_template_extraction(args):
    with open(args.all_reaction_file, "r") as csv_file:
        csv_reader = csv.DictReader(csv_file)
        reactions = list(csv_reader)

    # extract templates from reactions
    logging.info(f"Loaded all reaction SMILES and deduplicated. "
                 f"Parallelizing extraction over {args.num_cores} cores")
    rxns_with_template, templates, failed_count = _extract_templates_debug(
        reactions,
        max_workers=args.num_cores,
        template_set=args.data_name,
        partition=args.partition
    )
    logging.info(f'No of rxn where template extraction failed: {failed_count}')

if __name__ == "__main__":
    parser = argparse.ArgumentParser("debug_template_extraction")
    templ_rel_parser.add_model_opts(parser)
    templ_rel_parser.add_preprocess_opts(parser)
    args, unknown = parser.parse_known_args()

    # logger setup
    RDLogger.DisableLog("rdApp.warning")
    os.makedirs("./logs/debug", exist_ok=True)
    dt = datetime.strftime(datetime.now(), "%y%m%d-%H%Mh")
    args.log_file = f"./logs/debug/{args.log_file}.{dt}"
    logger = misc.setup_logger(args.log_file)
    misc.log_args(args, message="Logging arguments")

    start = time.time()
    random.seed(args.seed)

    debug_template_extraction(args)
