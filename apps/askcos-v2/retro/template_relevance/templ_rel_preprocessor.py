import argparse
import ast
import csv
import gzip
import json
import logging
import misc
import multiprocessing
import numpy as np
import os
import random
import templ_rel_parser
import time
import traceback
import utils
from datetime import datetime
from concurrent.futures import TimeoutError
from multiprocessing import Pool
from pebble import ProcessPool
from rdchiral.template_extractor import extract_from_reaction
from rdkit import Chem, RDLogger
from scipy import sparse
from tqdm import tqdm
from typing import Any, Dict, Iterable, List, Optional, Tuple
from utils import (
    canonicalize_smarts,
    canonicalize_smiles,
    mol_smi_to_count_fp
)


def _gen_product_fp(task: Tuple[str, int, int]) -> Tuple[sparse.csr_matrix, str]:
    line, radius, fp_size = task
    rxn_with_template = json.loads(line.strip())
    p_smi = rxn_with_template["rxn_smiles"].split(">")[-1]

    p_smi = canonicalize_smiles(p_smi, remove_atom_number=True)
    try:
        product_fp = mol_smi_to_count_fp(mol_smi=p_smi, radius=radius, fp_size=fp_size)
    except:
        logging.info(f"Error when converting smi to count fingerprint. "
                     f"Setting it to zero vector.")
        count_fp = np.zeros((1, fp_size), dtype=np.int32)
        product_fp = sparse.csr_matrix(count_fp, dtype="int32")

    canon_reaction_smarts = rxn_with_template["canon_reaction_smarts"]

    return product_fp, canon_reaction_smarts


def get_tpl(task: Tuple[int, Dict[str, Any]]) -> Tuple[int, Dict[str, Any]]:
    i, rxn = task
    rxn_id = rxn["id"]
    r_smi, _, p_smi = rxn["rxn_smiles"].strip().split(">")

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
        print (e)
        
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
) -> Tuple[int, str, str, bool, str, bool, bool]:
    i, row = task

    rxn_id = row["rxn_id"]
    rxn_smiles = row["rxn_smiles"]
    r_smi, _, p_smi = rxn_smiles.strip().split(">")

    reaction = {'_id': rxn_id, 'reactants': r_smi, 'products': p_smi}

    canon_reaction_smarts = ""
    template = None
    success = False

    try:
        with misc.BlockPrint():
            template = extract_from_reaction(reaction)
        p_templ = canonicalize_smarts(template["products"])
        r_templ = canonicalize_smarts(template["reactants"])

        # Note: "reaction_smarts" is actually: p_temp >> r_temp!
        canon_reaction_smarts = p_templ + '>>' + r_templ
        del p_templ, r_templ
        success = True

    except Exception as e:
        logging.info(e)

    if template is not None:
        intra_only = template.get("intra_only", False)
        dimer_only = template.get("dimer_only", False)
    else:
        intra_only = False
        dimer_only = False

    del r_smi, p_smi
    del reaction
    del row, template

    return i, rxn_id, rxn_smiles, success, canon_reaction_smarts, \
        intra_only, dimer_only


def dep(_args):
    i, rxn = _args
    if i % 10000 == 0:
        logging.info(f"{i} reactions processed.")
    r_smi, _, p_smi = rxn["rxn_smiles"].strip().split(">")

    canon_rxn_smi = ""

    canon_r_smi = canonicalize_smiles(r_smi, remove_atom_number=True)
    canon_p_smi = canonicalize_smiles(p_smi, remove_atom_number=True)
    if canon_r_smi and canon_p_smi:
        canon_rxn_smi = f"{canon_r_smi}>>{canon_p_smi}"

    return rxn, canon_rxn_smi


def _deduplicate(rxns: Iterable[Dict[str, Any]], num_workers: int
                 ) -> List[Dict[str, Any]]:
    p = Pool(num_workers)

    canon_rxn_smis = set()
    dedupped_rxns = []
    for rxn, canon_rxn_smi in tqdm(p.imap(dep, enumerate(rxns))):
        if not canon_rxn_smi:
            continue

        if canon_rxn_smi in canon_rxn_smis:
            continue
        else:
            canon_rxn_smis.add(canon_rxn_smi)
            dedupped_rxns.append(rxn)

    p.close()
    p.join()

    return dedupped_rxns


def _compute_historian_from_line(
    task: Tuple[int, str]
) -> Tuple[int, Optional[str], Optional[str]]:
    i, line = task
    if i == 0:
        return 0, None, None

    rxn_id, rxn_smiles = line.strip().split(",")
    r, _, p = rxn_smiles.strip().split(">")

    canon_rs = [
        canonicalize_smiles(smi, remove_atom_number=True)
        for smi in r.split(".")
    ]
    canon_ps = [
        canonicalize_smiles(smi, remove_atom_number=True)
        for smi in p.split(".")
    ]
    canon_r = ".".join(canon_rs)
    canon_p = ".".join(canon_ps)

    return i, canon_r, canon_p


def _extract_templates(
    rxns: List[Dict[str, Any]],
    max_workers: int,
    template_set: str
) -> Tuple[
    List[Dict[str, Any]],
    Dict[str, Dict[str, Any]],
    int
]:
    _start = time.time()
    rxns_with_template = []
    templates = {}
    failed_count = 0

    with ProcessPool(max_workers=max_workers) as pool:
        # Using pebble to add timeout, as rdchiral could hang
        future = pool.map(get_tpl, enumerate(rxns), timeout=10)
        iterator = future.result()

        # The while True - try/except/StopIteration is just pebble signature
        while True:
            try:
                i, rxn_with_template = next(iterator)
                if i > 0 and i % 10000 == 0:
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
                failed_count += 1
                rxn_with_template = rxns[i]
                rxn_with_template["canon_reaction_smarts"] = ""

            rxns_with_template.append(rxn_with_template)

    # pool.close()
    # pool.join()

    return rxns_with_template, templates, failed_count


def _sort_and_filter_templates(
    templates: Dict[str, Dict[str, Any]],
    min_freq: int,
    template_set: str
) -> Dict[str, Dict[str, Any]]:
    sorted_templates = sorted(
        templates.items(),
        key=lambda _tup: _tup[1]["count"],
        reverse=True
    )
    filtered_templates = {}
    id_prefix = template_set.replace(" ", "")

    for i, (canon_templ, metadata) in enumerate(sorted_templates):
        if metadata["count"] < min_freq:
            break
        metadata["index"] = i
        metadata["_id"] = f"{id_prefix}_{i}"
        filtered_templates[canon_templ] = metadata

    return filtered_templates


class TemplRelProcessor:
    """Class for Template Relevance Preprocessing"""

    def __init__(self, args):
        self.args = args

        self.model_name = args.model_name
        self.data_name = args.data_name
        self.log_file = args.log_file
        self.all_reaction_file = args.all_reaction_file
        self.train_file = args.train_file
        self.val_file = args.val_file
        self.test_file = args.test_file
        self.processed_data_path = args.processed_data_path
        self.num_cores = args.num_cores
        self.min_freq = args.min_freq

        os.makedirs(self.processed_data_path, exist_ok=True)

        self.is_data_presplit = args.is_data_presplit

    def preprocess(self, stage: str) -> None:
        # Hardcode every stage for now.
        # It's more or less templated and easily abstracted later
        if stage == "dedup_and_save_reactions":
            self.dedup_and_save_reactions()
        elif stage == "compute_and_save_historian":
            self.compute_and_save_historian()
        elif stage == "extract_templates_for_training":
            self.extract_templates_for_training()
        elif stage == "filter_and_save_templates_jsonl":
            self.filter_and_save_templates_jsonl()

        # these two truncate functions are either/or
        elif stage == "truncate_all_reactions_and_split":
            assert not self.is_data_presplit
            self.truncate_all_reactions_and_split()
        elif stage == "truncate_train_reactions_and_extract_val_test":
            assert self.is_data_presplit
            self.truncate_train_reactions_and_extract_val_test()

        elif stage == "featurize":
            assert all(os.path.exists(file) for file in [
                os.path.join(self.processed_data_path, "train_rxns_with_template.jsonl"),
                os.path.join(self.processed_data_path, "val_rxns_with_template.jsonl"),
                os.path.join(self.processed_data_path, "test_rxns_with_template.jsonl"),
                os.path.join(self.processed_data_path, "templates.jsonl"),
            ])
            self.featurize()

    def check_data_format(self) -> None:
        """
        Check that all files exists and the data format is correct for the
        first few lines
        """
        check_count = 100

        logging.info(f"Checking the first {check_count} entries for each file")
        assert os.path.exists(self.all_reaction_file) or \
               os.path.exists(self.train_file), \
               f"Either the train file ({self.train_file}) " \
               f"or the file with all reactions ({self.all_reaction_file}) " \
               f"needs to be supplied!"

        for fn in [self.train_file, self.val_file, self.test_file,
                   self.all_reaction_file]:
            if not fn:
                continue
            if not os.path.exists(fn):
                logging.info(f"{fn} does not exist, skipping format check")
                continue

            with open(fn, "r") as csv_file:
                csv_reader = csv.DictReader(csv_file)
                for i, row in enumerate(csv_reader):
                    if i > check_count:
                        break

                    assert (c in row for c in ["id", "rxn_smiles"]), \
                        f"Error processing file {fn} line {i}, ensure columns 'id' " \
                        f"and 'rxn_smiles' are included!"

                    reactants, reagents, products = row["rxn_smiles"].split(">")
                    # simply ensures that SMILES can be parsed
                    Chem.MolFromSmiles(reactants)
                    Chem.MolFromSmiles(products)

        logging.info("Data format check passed")

    def dedup_and_save_reactions(self) -> None:
        reaction_file_for_preprocessing = os.path.join(
            self.processed_data_path,
            f"unique_reactions.{self.data_name}.csv"
        )
        reaction_file_for_db = os.path.join(
            self.processed_data_path,
            f"reactions.{self.data_name}.json.gz"
        )

        if os.path.exists(reaction_file_for_preprocessing) \
            and os.path.exists(reaction_file_for_db):
            logging.info(f"Found {reaction_file_for_preprocessing} "
                         f"and {reaction_file_for_db}, "
                         f"skipping reaction deduplication.")

            return

        if self.is_data_presplit:
            logging.info(f"Data is presplit. Preprocessing reactions from "
                         f"{self.train_file}..")
            file = self.train_file
        else:
            logging.info(f"Data is not presplit. Preprocessing reactions from "
                         f"{self.all_reaction_file}..")
            file = self.all_reaction_file

        with open(file, "r") as csv_file:
            csv_reader = csv.DictReader(csv_file)
            dedupped_rxns = _deduplicate(csv_reader, self.num_cores)

        logging.info("Done deduplicating reactions. Shuffling..")
        random.shuffle(dedupped_rxns)

        # save dedupped reactions for db seeding (if the user wants)
        utils.save_reactions_from_list(
            reactions=dedupped_rxns,
            template_set=self.data_name,
            reaction_file_for_preprocessing=reaction_file_for_preprocessing,
            reaction_file_for_db=reaction_file_for_db
        )

        del dedupped_rxns

    def compute_and_save_historian(self) -> None:
        # compute and save historian for db seeding (if the user wants)
        logging.info(f"Computing historian data")
        _start = time.time()

        reaction_file_for_preprocessing = os.path.join(
            self.processed_data_path,
            f"unique_reactions.{self.data_name}.csv"
        )
        historian_file_for_db = os.path.join(
            self.processed_data_path,
            f"historian.{self.data_name}.json.gz"
        )
        if os.path.exists(historian_file_for_db):
            logging.info(f"Found {historian_file_for_db}, "
                         f"skipping historian computation.")

            return

        p = multiprocessing.Pool(self.num_cores)
        historian = {}

        with open(reaction_file_for_preprocessing, "r") as f:
            for i, canon_r, canon_p in tqdm(
                p.imap(_compute_historian_from_line, enumerate(f))
            ):
                if i == 0:
                    # skip the header line
                    continue

                if i % 10000 == 0:
                    logging.info(f"Processing {i}th line for computing historian, "
                                 f"elapsed time: {time.time() - _start: .0f} s")

                for canon_smi in canon_r.split("."):
                    if canon_smi not in historian:
                        historian[canon_smi] = {"as_reactant": 1, "as_product": 0}
                    else:
                        historian[canon_smi]["as_reactant"] += 1
                for canon_smi in canon_p.split("."):
                    if canon_smi not in historian:
                        historian[canon_smi] = {"as_reactant": 0, "as_product": 1}
                    else:
                        historian[canon_smi]["as_reactant"] += 1

        p.close()
        p.join()

        historian = [
            {
                "smiles": smi,
                "as_reactant": hist["as_reactant"],
                "as_product": hist["as_product"],
                "template_set": self.data_name
            }
            for smi, hist in historian.items()
        ]

        logging.info(f"Saving historian for db seeding to {historian_file_for_db}")
        with gzip.open(historian_file_for_db, "wt", encoding="UTF-8") as zipfile:
            json.dump(historian, zipfile)

        del historian

    def extract_templates_for_training(self) -> None:
        reaction_file_for_preprocessing = os.path.join(
            self.processed_data_path,
            f"unique_reactions.{self.data_name}.csv"
        )
        reaction_file_with_templates = os.path.join(
            self.processed_data_path,
            f"reactions_with_templates.{self.data_name}.csv"
        )
        if os.path.exists(reaction_file_with_templates):
            logging.info(f"Found {reaction_file_with_templates}, "
                         f"skipping template extraction from training data.")

            return

        logging.info(f"Extracting templates for training and saving reactions "
                     f"with templates to {reaction_file_with_templates}. "
                     f"Parallelizing extraction over {self.num_cores} cores")
        _start = time.time()

        with (
            open(reaction_file_for_preprocessing, "r") as f,
            open(reaction_file_with_templates, "w") as of
        ):
            csv_reader = csv.DictReader(f)
            failed_count = 0
            of.write(f"rxn_id,rxn_smiles,success,canon_reaction_smarts,"
                     f"intra_only,dimer_only\n")

            with ProcessPool(max_workers=self.num_cores) as pool:
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
                        i, rxn_id, rxn_smiles, success, canon_reaction_smarts, \
                            intra_only, dimer_only = next(iterator)
                        of.write(f"{rxn_id},{rxn_smiles},{success},{canon_reaction_smarts},"
                                 f"{intra_only},{dimer_only}\n")

                        if i > 0 and i % 10000 == 0:
                            logging.info(f"Processing {i}th line, "
                                         f"elapsed time: {time.time() - _start: .0f} s")

                        if not success:
                            failed_count += 1
                    except StopIteration:
                        break
                    except TimeoutError as error:
                        logging.info(f"get_tpl() call took more than {error.args} seconds.")

                        failed_count += 1
                        of.write(f"{rxn_id},{rxn_smiles},{False},,,\n")
                    except:
                        logging.info(f"Unknown error for getting template.")
                        logging.info(f"Traceback: {traceback.format_exc()}")

                        failed_count += 1
                        of.write(f"{rxn_id},{rxn_smiles},{False},,,\n")

        logging.info(f'No of rxn where template extraction failed: {failed_count}')

    def filter_and_save_templates_jsonl(self) -> None:
        reaction_file_with_templates = os.path.join(
            self.processed_data_path,
            f"reactions_with_templates.{self.data_name}.csv"
        )
        template_file = os.path.join(self.processed_data_path, "templates.jsonl")
        if os.path.exists(template_file):
            logging.info(f"Found {template_file}, "
                         f"skipping template counting and filtering.")

            return

        logging.info(f"Counting by template from {reaction_file_with_templates}")

        templates = {}
        with open(reaction_file_with_templates, "r") as f:
            csv_reader = csv.DictReader(f)

            for row in tqdm(csv_reader):
                if not row["success"]:
                    continue
                if not row["canon_reaction_smarts"]:
                    continue

                canon_reaction_smarts = row["canon_reaction_smarts"]
                if canon_reaction_smarts in templates:
                    templates[canon_reaction_smarts] += 1
                else:
                    templates[canon_reaction_smarts] = 1

        logging.info(f"Filtering template by min frequency {self.min_freq} and sorting")
        filtered_templates = [
            (canon_reaction_smarts, count)
            for canon_reaction_smarts, count in templates.items()
            if count >= self.min_freq
        ]
        del templates

        filtered_templates = sorted(
            filtered_templates,
            key=lambda _tup: _tup[1],
            reverse=True
        )
        id_prefix = self.data_name.replace(" ", "")
        filtered_templates = {
            canon_reaction_smarts: {
                "index": i,
                "reaction_smarts": canon_reaction_smarts,
                "count": count,
                "necessary_reagent": "",
                "intra_only": False,
                "dimer_only": False,
                "template_set": self.data_name,
                "references": [],
                "attributes": {
                    "ring_delta": 1.0,
                    "chiral_delta": 0
                },
                "_id": f"{id_prefix}_{i}"
            }
            for i, (canon_reaction_smarts, count) in enumerate(filtered_templates)
        }

        logging.info(f"Saving filtered templates to {template_file}")
        with open(template_file, "w") as of:
            for canon_templ, metadata in filtered_templates.items():
                assert metadata["reaction_smarts"] == canon_templ
                if "rxn" in metadata:
                    del metadata["rxn"]
                of.write(f"{json.dumps(metadata)}\n")

        del filtered_templates

    def truncate_all_reactions_and_split(self) -> None:
        # NOTE: template files for db seeding is saved *HERE*
        _start = time.time()

        reaction_file_with_templates = os.path.join(
            self.processed_data_path,
            f"reactions_with_templates.{self.data_name}.csv"
        )
        template_file = os.path.join(self.processed_data_path, "templates.jsonl")
        templates = utils.load_templates_as_dict(template_file)

        logging.info(f"Truncating reactions whose templates are not in {template_file}..")

        # filter reactions by templates
        rxns_with_template = []
        with open(reaction_file_with_templates, "r") as csv_file:
            reader = csv.DictReader(csv_file)

            for row in tqdm(reader):
                if not row["success"]:
                    continue
                if row["canon_reaction_smarts"] not in templates:
                    continue

                rxns_with_template.append(row)

                # a bit verbose but for the sake of clarity
                # csv saved things as "True" and "False" strings so ast is needed
                metadata = templates[row["canon_reaction_smarts"]]
                metadata["intra_only"] = ast.literal_eval(row["intra_only"])
                metadata["dimer_only"] = ast.literal_eval(row["dimer_only"])
                metadata["references"].append(row["rxn_id"])
                templates[row["canon_reaction_smarts"]] = metadata

        logging.info(f"Done truncating reactions, "
                     f"number of reactions with templates: {len(rxns_with_template)}")

        logging.info(f"Saving templates with updated metadata back to {template_file}")
        with open(template_file, "w") as of:
            for canon_templ, metadata in templates.items():
                assert metadata["reaction_smarts"] == canon_templ
                if "rxn" in metadata:
                    del metadata["rxn"]
                of.write(f"{json.dumps(metadata)}\n")

        template_file_for_db = os.path.join(
            self.processed_data_path,
            f"retro.templates.{self.data_name}.json.gz"
        )
        templates_as_list = list(templates.values())
        logging.info(f"Saving templates for db seeding to {template_file_for_db}")
        with gzip.open(template_file_for_db, "wt", encoding="UTF-8") as zipfile:
            json.dump(templates_as_list, zipfile)

        del templates, templates_as_list

        # split
        split_ratio = [float(r) for r in self.args.split_ratio.split(":")]
        split_ratio = [val / sum(split_ratio) for val in split_ratio]
        assert len(split_ratio) == 3
        random.shuffle(rxns_with_template)

        train_count = int(len(rxns_with_template) * split_ratio[0])
        val_count = int(len(rxns_with_template) * split_ratio[1])
        train_rxns = rxns_with_template[:train_count]
        val_rxns = rxns_with_template[train_count:train_count + val_count]
        test_rxns = rxns_with_template[train_count + val_count:]

        for rxns, phase in [(train_rxns, "train"),
                            (val_rxns, "val"),
                            (test_rxns, "test")]:
            ofn = os.path.join(self.processed_data_path, f"{phase}_rxns_with_template.jsonl")
            logging.info(f"Saving reactions with templates to {ofn}")
            with open(ofn, "w") as of:
                for rxn in rxns:
                    of.write(f"{json.dumps(rxn)}\n")

        logging.info(f"Done truncating and splitting, "
                     f"time: {time.time() - _start: .2f} s")


    def truncate_train_reactions_and_extract_val_test(self) -> None:
        # NOTE: template files for db seeding is saved *HERE*
        _start = time.time()

        reaction_file_with_templates = os.path.join(
            self.processed_data_path,
            f"reactions_with_templates.{self.data_name}.csv"
        )
        template_file = os.path.join(self.processed_data_path, "templates.jsonl")
        templates = utils.load_templates_as_dict(template_file)

        logging.info(f"Truncating reactions whose templates are not in {template_file}..")

        # filter reactions by templates
        rxns_with_template = []
        with open(reaction_file_with_templates, "r") as csv_file:
            reader = csv.DictReader(csv_file)

            for row in tqdm(reader):
                if not row["success"]:
                    continue
                if row["canon_reaction_smarts"] not in templates:
                    continue

                rxns_with_template.append(row)

                # a bit verbose but for the sake of clarity
                # csv saved things as "True" and "False" strings so ast is needed
                metadata = templates[row["canon_reaction_smarts"]]
                metadata["intra_only"] = ast.literal_eval(row["intra_only"])
                metadata["dimer_only"] = ast.literal_eval(row["dimer_only"])
                metadata["references"].append(row["rxn_id"])
                templates[row["canon_reaction_smarts"]] = metadata

        logging.info(f"Done truncating reactions, "
                     f"number of reactions with templates: {len(rxns_with_template)}")

        logging.info(f"Saving templates with updated metadata back to {template_file}")
        with open(template_file, "w") as of:
            for canon_templ, metadata in templates.items():
                assert metadata["reaction_smarts"] == canon_templ
                if "rxn" in metadata:
                    del metadata["rxn"]
                of.write(f"{json.dumps(metadata)}\n")

        template_file_for_db = os.path.join(
            self.processed_data_path,
            f"retro.templates.{self.data_name}.json.gz"
        )
        templates_as_list = list(templates.values())
        logging.info(f"Saving templates for db seeding to {template_file_for_db}")
        with gzip.open(template_file_for_db, "wt", encoding="UTF-8") as zipfile:
            json.dump(templates_as_list, zipfile)

        del templates, templates_as_list

        # Things start differing here
        train_rxns_with_template = rxns_with_template

        # save filtered train reactions
        ofn = os.path.join(self.processed_data_path, "train_rxns_with_template.jsonl")
        with open(ofn, "w") as of:
            for rxn in train_rxns_with_template:
                of.write(f"{json.dumps(rxn)}\n")

        # for val and test we'll keep all reactions
        # codes copied over from previous version, as OOM should be much less of a concern
        for file, phase in [(self.val_file, "val"),
                            (self.test_file, "test")]:
            with open(file, "r") as csv_file:
                csv_reader = csv.DictReader(csv_file)

                # extract templates from val and test reactions
                logging.info(f"Loaded all reaction SMILES from {file}. "
                             f"Parallelizing extraction over {self.num_cores} cores")
                rxns_with_template, _, failed_count = _extract_templates(
                    list(csv_reader),
                    max_workers=self.num_cores,
                    template_set=self.data_name
                )
                logging.info(f"No of rxn where template extraction failed: {failed_count}")

            ofn = os.path.join(self.processed_data_path, f"{phase}_rxns_with_template.jsonl")
            with open(ofn, "w") as of:
                for rxn in rxns_with_template:
                    of.write(f"{json.dumps(rxn)}\n")

            logging.info(f"Done template extraction for {phase}, "
                         f"time: {time.time() - _start: .2f} s")

        logging.info(f"Done truncating and splitting, "
                     f"time: {time.time() - _start: .2f} s")

    def featurize(self):
        logging.info("(Re-)loading templates for featurization")
        templates = utils.load_templates_as_dict(
            template_file=os.path.join(self.processed_data_path, "templates.jsonl")
        )
        for phase in ["train", "val", "test"]:
            fn = os.path.join(self.processed_data_path,
                              f"{phase}_rxns_with_template.jsonl")
            logging.info(f"Loading rxns_with_template from {fn} "
                         f"and featurizing over {self.num_cores} cores")
            pool = multiprocessing.Pool(self.num_cores)

            product_fps = []
            labels = []

            with open(fn, "r") as f:
                lines = f.readlines()
            tasks = [(line, self.args.radius, self.args.fp_size)
                     for line in lines]
            for result in tqdm(pool.imap(_gen_product_fp, tasks),
                               total=len(tasks),
                               desc="Processing line "):
                product_fp, canon_reaction_smarts = result
                product_fps.append(product_fp)

                if canon_reaction_smarts and canon_reaction_smarts in templates:
                    label = templates[canon_reaction_smarts]["index"]
                else:
                    label = -1
                labels.append(label)

            pool.close()
            pool.join()

            product_fps = sparse.vstack(product_fps)
            sparse.save_npz(
                os.path.join(self.processed_data_path, f"product_fps_{phase}.npz"),
                product_fps
            )
            np.save(
                os.path.join(self.processed_data_path, f"labels_{phase}.npy"),
                np.asarray(labels)
            )


if __name__ == "__main__":
    parser = argparse.ArgumentParser("template_relevance")
    templ_rel_parser.add_model_opts(parser)
    templ_rel_parser.add_preprocess_opts(parser)
    args, unknown = parser.parse_known_args()

    # logger setup
    RDLogger.DisableLog("rdApp.*")
    os.makedirs("./logs/preprocess", exist_ok=True)
    dt = datetime.strftime(datetime.now(), "%y%m%d-%H%Mh")
    args.log_file = f"./logs/preprocess/{args.log_file}.{dt}"
    logger = misc.setup_logger(args.log_file)
    misc.log_args(args, message="Logging arguments")

    start = time.time()
    random.seed(args.seed)

    processor = TemplRelProcessor(args)
    processor.check_data_format()
    processor.preprocess(stage=args.stage)

    logging.info(f"Preprocessing done, total time: {time.time() - start: .2f} s")
