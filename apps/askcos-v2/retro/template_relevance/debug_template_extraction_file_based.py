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
from multiprocessing import Pool
from rdchiral.template_extractor import extract_from_reaction
from rdkit import RDLogger
from typing import Any, Dict, List, Optional, Tuple
from utils import canonicalize_smarts


def get_tpl_file_based(
    task: Tuple[int, Dict[str, Any]]
) -> Tuple[int, Optional[Dict[str, Any]]]:
    i, row = task

    rxn_id = row["id"]
    rxn_smiles = row["rxn_smiles"]
    r_smi, _, p_smi = rxn_smiles.strip().split(">")

    reaction = {'_id': rxn_id, 'reactants': r_smi, 'products': p_smi}

    canon_templ = ""
    template = None

    try:
        with misc.BlockPrint():
            template = extract_from_reaction(reaction)
        p_templ = canonicalize_smarts(template["products"])
        r_templ = canonicalize_smarts(template["reactants"])

        # Note: "reaction_smarts" is actually: p_temp >> r_temp!
        canon_templ = p_templ + '>>' + r_templ

    except Exception as e:
        print(e)

    rxn = row
    rxn_with_template = rxn
    rxn_with_template["canon_reaction_smarts"] = canon_templ

    if template is not None:
        rxn_with_template["intra_only"] = template.get("intra_only", False)
        rxn_with_template["dimer_only"] = template.get("dimer_only", False)
    else:
        rxn_with_template["intra_only"] = False
        rxn_with_template["dimer_only"] = False

    return i, rxn_with_template


def get_tpl_file_based_flattened(
    task: Tuple[int, Dict[str, Any]]
) -> Tuple[int, str, str, bool, str, str, bool, bool]:
    i, row = task

    rxn_id = row["id"]
    rxn_smiles = row["rxn_smiles"]
    r_smi, _, p_smi = rxn_smiles.strip().split(">")

    reaction = {'_id': rxn_id, 'reactants': r_smi, 'products': p_smi}

    canon_templ = ""
    template = None
    success = False

    try:
        with misc.BlockPrint():
            template = extract_from_reaction(reaction)
        p_templ = canonicalize_smarts(template["products"])
        r_templ = canonicalize_smarts(template["reactants"])

        # Note: "reaction_smarts" is actually: p_temp >> r_temp!
        canon_templ = p_templ + '>>' + r_templ
        del p_templ, r_templ
        success = True

    except Exception as e:
        print(e)

    canon_reaction_smarts = canon_templ
    rxn_smarts = canon_reaction_smarts

    if template is not None:
        intra_only = template.get("intra_only", False)
        dimer_only = template.get("dimer_only", False)
    else:
        intra_only = False
        dimer_only = False

    del r_smi, p_smi
    del reaction
    del row, template
    del canon_templ

    return i, rxn_id, rxn_smiles, success, rxn_smarts, canon_reaction_smarts, \
        intra_only, dimer_only


def debug_template_extraction_file_based(args):
    _start = time.time()

    with open(args.all_reaction_file, "r") as csv_file:
        csv_reader = csv.DictReader(csv_file)

        rxns_with_template = []
        templates = {}
        failed_count = 0

        with ProcessPool(max_workers=args.num_cores) as pool:
            # Using pebble to add timeout, as rdchiral could hang
            future = pool.map(
                get_tpl_file_based,
                enumerate(csv_reader),
                timeout=10
            )
            iterator = future.result()

            # The while True - try/except/StopIteration is just pebble signature
            while True:
                try:
                    i, rxn_with_template = next(iterator)
                    if i > 0 and i % 1000 == 0:
                        logging.info(f"Processing {i}th line, "
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
                                "index": -1,  # placeholder, to be reset after sorting
                                "reaction_smarts": canon_reaction_smarts,
                                "count": 1,
                                "necessary_reagent": "",
                                "intra_only": intra_only,
                                "dimer_only": dimer_only,
                                "template_set": args.data_name,
                                "references": [rxn_id],
                                "attributes": {
                                    "ring_delta": 1.0,
                                    "chiral_delta": 0
                                },
                                "_id": "-1"  # placeholder, to be reset after sorting
                            }
                    else:
                        failed_count += 1
                except StopIteration:
                    break
                except TimeoutError as error:
                    logging.info(f"get_tpl() call took more than {error.args} seconds.")
                    failed_count += 1
                    rxn_with_template = {"canon_reaction_smarts": ""}
                except:
                    logging.info(f"Unknown error for getting template.")
                    logging.info(f"Traceback: {traceback.format_exc()}")

                    failed_count += 1
                    rxn_with_template = {"canon_reaction_smarts": ""}

                rxns_with_template.append(rxn_with_template)

    logging.info(f'No of rxn where template extraction failed: {failed_count}')

    return templates, rxns_with_template


def debug_template_extraction_file_based_no_store(args):
    _start = time.time()
    processed_file_name = f"{args.all_reaction_file}.extracted.no_store.csv"

    with open(args.all_reaction_file, "r") as f, open(processed_file_name, "w") as of:
        csv_reader = csv.DictReader(f)
        failed_count = 0
        of.write(f"rxn_id,rxn_smiles,success,rxn_smarts,canon_reaction_smarts,"
                 f"intra_only,dimer_only\n")

        with ProcessPool(max_workers=args.num_cores) as pool:
            # Using pebble to add timeout, as rdchiral could hang
            future = pool.map(
                get_tpl_file_based_flattened,
                enumerate(csv_reader),
                timeout=10
            )
            iterator = future.result()

            # The while True - try/except/StopIteration is just pebble signature
            while True:
                try:
                    i, rxn_id, rxn_smiles, success, rxn_smarts, canon_reaction_smarts, \
                        intra_only, dimer_only = next(iterator)
                    of.write(f"{rxn_id},{rxn_smiles},{success},{rxn_smarts},{canon_reaction_smarts},"
                             f"{intra_only},{dimer_only}\n")

                    if i > 0 and i % 1000 == 0:
                        logging.info(f"Processing {i}th line, "
                                     f"elapsed time: {time.time() - _start: .0f} s")

                    if not success:
                        failed_count += 1
                except StopIteration:
                    break
                except TimeoutError as error:
                    logging.info(f"get_tpl() call took more than {error.args} seconds.")

                    failed_count += 1
                    of.write(f"{rxn_id},{rxn_smiles},{success},,,,\n")
                except:
                    logging.info(f"Unknown error for getting template.")
                    logging.info(f"Traceback: {traceback.format_exc()}")

                    failed_count += 1
                    of.write(f"{rxn_id},{rxn_smiles},{success},,,,\n")

    logging.info(f'No of rxn where template extraction failed: {failed_count}')


def parse_extracted(task: Tuple[int, str]) -> Tuple[int, Dict[str, Any]]:
    i, line = task
    if i == 0:
        return 0, None

    rxn_id, rxn_smiles, success, rxn_smarts, canon_reaction_smarts, \
        intra_only, dimer_only = line.strip().split(",")

    rxn = {
        "id": rxn_id,
        "rxn_smiles": rxn_smiles
    }
    rxn_with_template = rxn
    rxn_with_template["canon_reaction_smarts"] = canon_reaction_smarts
    rxn_with_template["intra_only"] = intra_only
    rxn_with_template["dimer_only"] = dimer_only

    return i, rxn_with_template


def debug_deduplicate_templates(args) -> Tuple[Dict[str, Any], List]:
    logging.info("Deduplicating templates")

    processed_file_name = f"{args.all_reaction_file}.extracted.no_store.csv"

    with open(processed_file_name, "r") as f:
        _start = time.time()
        pool = Pool(args.num_cores)

        rxns_with_template = []
        templates = {}

        for i, rxn_with_template in pool.imap(parse_extracted, enumerate(f)):
            if i == 0:
                continue

            if i > 0 and i % 1000 == 0:
                logging.info(f"Processing {i}th line, "
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
                        "index": -1,  # placeholder, to be reset after sorting
                        "reaction_smarts": canon_reaction_smarts,
                        "count": 1,
                        "necessary_reagent": "",
                        "intra_only": intra_only,
                        "dimer_only": dimer_only,
                        "template_set": args.data_name,
                        "references": [rxn_id],
                        "attributes": {
                            "ring_delta": 1.0,
                            "chiral_delta": 0
                        },
                        "_id": "-1"  # placeholder, to be reset after sorting
                    }
            rxns_with_template.append(rxn_with_template)

        pool.close()
        pool.join()

        return templates, rxns_with_template



if __name__ == "__main__":
    parser = argparse.ArgumentParser("debug_template_extraction")
    templ_rel_parser.add_model_opts(parser)
    templ_rel_parser.add_preprocess_opts(parser)
    parser.add_argument("--store_rxn", help="whether to store rxn_with_template",
                        action="store_true", default=False)
    args, unknown = parser.parse_known_args()

    # logger setup
    RDLogger.DisableLog("rdApp.warning")
    os.makedirs("./logs/debug", exist_ok=True)
    dt = datetime.strftime(datetime.now(), "%y%m%d-%H%Mh")
    args.log_file = f"./logs/debug/{args.log_file}.{args.store_rxn}.{dt}"
    logger = misc.setup_logger(args.log_file)
    misc.log_args(args, message="Logging arguments")

    start = time.time()
    random.seed(args.seed)

    if args.store_rxn:
        templates, rxns_with_template = debug_template_extraction_file_based(args)
    else:
        debug_template_extraction_file_based_no_store(args)
        templates, rxns_with_template = debug_deduplicate_templates(args)
