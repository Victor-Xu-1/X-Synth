import numpy as np
import os
import time
from api.atom_map_api import AtomMapAPI
from api.cluster_api import ClusterAPI, ClusterSetting
from api.fast_filter_api import FastFilterAPI
from api.fast_filter_batch_api import FastFilterBatchAPI
from api.pricer_api import PricerAPI
from api.pricer_smarts_api import PricerSmartsAPI
from api.retro_api import RetroAPI
from api.abs_group_api import AbsGroupAPI
from config import HIGHER_LEVEL_MODEL_NAMES
from api.scscorer_api import SCScorerAPI
from api.scscorer_batch_api import SCScorerBatchAPI
from descriptors_util import number_of_rings, rms_molecular_weight
from multiprocessing import Pool
from pydantic import BaseModel, Field
from rdchiral.template_extractor import extract_from_reaction
from rdchiral_util import apply_one_template_to_precursors, get_reacting_atoms
from rdkit import Chem
from typing import Any, Dict, List, Optional, Tuple

GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://0.0.0.0:9100")
atom_mapper = AtomMapAPI(
    url=f"{GATEWAY_URL}/api/atom-map/call-sync",
    backend="rxnmapper"
)
clusterer = ClusterAPI(
    default_url=f"{GATEWAY_URL}/api/cluster/call-sync"
)
# fast_filter = FastFilterAPI(
#     default_url=f"{GATEWAY_URL}/api/fast-filter/call-sync"
# )
fast_filter_batch = FastFilterBatchAPI(
    default_url=f"{GATEWAY_URL}/api/fast-filter/batch/call-sync"
)
pricer = PricerAPI(
    default_url=f"{GATEWAY_URL}/api/pricer/lookup-smiles"
)
pricer_smarts = PricerSmartsAPI(
    lookup_smarts_url=f"{GATEWAY_URL}/api/pricer/lookup-smarts",
)
# scscorer = SCScorerAPI(
#     default_url=f"{GATEWAY_URL}/api/scscore/call-sync"
# )
scscorer_batch = SCScorerBatchAPI(
    default_url=f"{GATEWAY_URL}/api/scscore/batch/call-sync"
)
retro_controller = RetroAPI(
    default_url=f"{GATEWAY_URL}/api/retro/call-sync",
    default_backend="template_relevance"
)
abs_group_api = AbsGroupAPI(base_url=f"{GATEWAY_URL}/api/rdkit")

# Model names whose outcomes may contain abstracted-group isotope labels.
# Only these trigger abs_group_handler calls in postprocessing.

PRECURSOR_PROPS = [
    "rms_molwt",
    "num_rings",
    "scscore",
    "precursor_prices",
]

FINAL_RESULT_KEYS = [
    "outcome",
    "precursor_score",
    "precursor_rank",
    "average_model_score",
    "model_metadata",
    "precursor_properties",
    "reaction_properties",
]




class RetroBackendOption(BaseModel):
    retro_backend: str = "template_relevance"
    retro_model_name: str = "reaxys"
    max_num_templates: int = 100
    max_cum_prob: float = 0.995
    attribute_filter: Optional[List[Dict[str, Any]]] = Field(default_factory=list)

    threshold: float = 0.3
    top_k: int = 10

    field_mapping = {
        "template_relevance": {
            'max_num_templates', 
            'max_cum_prob', 
            'attribute_filter'
        },
        "retrosim": {
            'threshold', 
            'top_k'
        }
    }

    def to_dict(self):

        # Get the fields to include based on the retro_backend value
        fields_to_include = self.field_mapping.get(self.retro_backend, set())

        # Return the dictionary including only the specified fields
        return self.dict(include=fields_to_include, exclude_defaults=False)

def _price_fragment(
    smiles: str,
    use_smarts: bool,
    cache: Dict[str, Tuple[float, str, str]],
) -> Tuple[float, str, str]:
    if smiles in cache:
        return cache[smiles]

    if use_smarts and _has_abs_groups(smiles):
        ppg, source, smiles_match = pricer_smarts(smiles)
    else:
        ppg = pricer(smiles=smiles, canonicalize=False)
        source = ""
        smiles_match = ""

    cache[smiles] = (ppg, source, smiles_match)
    return ppg, source, smiles_match


def _prefetch_exact_fragment_prices(
    outcomes: List[str],
    *,
    use_smarts: bool,
    price_client: PricerAPI,
    cache: Dict[str, Tuple[float, str, str]],
) -> None:
    """Populate exact fragment prices with one batch database request."""

    fragments = list(dict.fromkeys(
        fragment
        for outcome in outcomes
        for fragment in outcome.split(".")
    ))
    exact_fragments = [
        fragment
        for fragment in fragments
        if not (use_smarts and _has_abs_groups(fragment))
    ]
    prices = price_client.lookup_many(exact_fragments, canonicalize=False)
    for fragment in exact_fragments:
        ppg, source = prices.get(fragment, (0.0, ""))
        cache[fragment] = (ppg, source, "")


def _get_relevance(_args) -> float:
    reactant_smiles, necessary_reagent, model_score, fragment_prices = _args
    necessary_reagent_atoms = necessary_reagent.count("[") / 2.0
    scores = []
    for smiles in reactant_smiles.split("."):
        ppg = fragment_prices.get(smiles, 0.0)
        # If buyable, basically free
        if ppg:
            scores.append(-ppg / 1000.0)
            continue

        # Else, use heuristic
        mol = Chem.MolFromSmiles(smiles)
        total_atoms = mol.GetNumHeavyAtoms()
        ring_bonds = sum(b.IsInRing() - b.GetIsAromatic() for b in mol.GetBonds())
        chiral_centers = len(Chem.FindMolChiralCenters(mol))

        scores.append(
            -2.00 * np.power(total_atoms, 1.5)
            - 1.00 * np.power(ring_bonds, 1.5)
            - 2.00 * np.power(chiral_centers, 2.0)
        )

    score = np.sum(scores) - 4.00 * np.power(necessary_reagent_atoms, 2.0)
    score = score / model_score

    return score

def canonicalize_smiles(smi):
    molecule = Chem.MolFromSmiles(smi)
    for atom in molecule.GetAtoms():
        atom.SetAtomMapNum(0)
    return Chem.MolToSmiles(molecule, isomericSmiles=True)


def _atom_is_abs_group(atom: Chem.Atom) -> bool:
    """Match ASKCOS abstracted-group isotopes without a gateway round trip."""

    isotope = atom.GetIsotope()
    if not isotope:
        return False
    if atom.GetAtomicNum() == 6:
        return 1 <= isotope <= 5
    return atom.GetAtomicNum() != 1 and isotope == 1


def _has_abs_groups(smiles: str) -> bool:
    molecule = Chem.MolFromSmiles(smiles)
    return bool(molecule) and any(
        _atom_is_abs_group(atom) for atom in molecule.GetAtoms()
    )


def print_if_debug(m: str, debug: bool = False):
    if debug:
        print(m)


class ExpandOneController:
    def __init__(self):
        self.atom_mapper = atom_mapper
        self.clusterer = clusterer
        # self.fast_filter = fast_filter
        self.fast_filter_batch = fast_filter_batch
        self.pricer = pricer
        # self.scscorer = scscorer
        self.scscorer_batch = scscorer_batch
        self.retro_controller = retro_controller
        self.abs_group_handler = abs_group_api.abs_group_handler
        self.p = Pool()

    def get_outcomes(
        self,
        smiles: str,
        retro_backend_options: List[RetroBackendOption],
        banned_chemicals: List[str] = None,
        banned_reactions: List[str] = None,
        use_fast_filter: bool = True,
        fast_filter_threshold: float = 0.75,
        retro_rerank_backend: str = "relevance_heuristic",
        atom_map_backend: str = "rxnmapper",
        cluster_precursors: bool = True,
        cluster_setting: ClusterSetting = None,
        max_num_for_clustering: int = 100,
        extract_template: bool = False,
        return_reacting_atoms: bool = True,
        selectivity_check: bool = False,
        debug: bool = False
    ) -> List[Dict[str, any]]:
        if not banned_chemicals:
            banned_chemicals = []
        if not banned_reactions:
            banned_reactions = []

        # retro_controller takes in list[str], here we only pass in one smiles
        # retro_results is list[dict]
        start = time.time()
        retro_results = []
        cano_smiles = canonicalize_smiles(smiles)
        for option in retro_backend_options:
            batch = self.retro_controller(
                smiles=[cano_smiles],
                backend=option.retro_backend,
                model_name=option.retro_model_name,
                max_num_templates=option.max_num_templates,
                max_cum_prob=option.max_cum_prob,
                attribute_filter=option.attribute_filter,
                threshold=option.threshold,
                top_k=option.top_k
            )
            if batch is None:
                print_if_debug(
                    f"retro call failed for {option.retro_backend}/"
                    f"{option.retro_model_name}; skipping this backend",
                    debug,
                )
                continue
            retro_result = batch[0]

            current_rank = 0
            previous_score = None

            for i, result in enumerate(retro_result):
                if previous_score is None or result["normalized_model_score"] != previous_score:
                    current_rank = i + 1 
                
                result["direction"] = "retro"
                result["backend"] = option.retro_backend
                result["model_name"] = option.retro_model_name
                result["attributes"] = option.to_dict()
                result["rank"] = current_rank

                result["source"] = {
                    "template": result.pop("template"),        # Move template into source
                    "reaction_data": result.pop("reaction_data")  # Move reaction_data into source
                }


                previous_score = result["normalized_model_score"]

            retro_results.extend(retro_result)

        print_if_debug(f"retro: {time.time() - start}", debug)

        # A number of postprocessing steps
        # <deduplication>
        start = time.time()
        mol = Chem.MolFromSmiles(smiles)
        cano_smiles = Chem.MolToSmiles(mol, isomericSmiles=True)
        
        results_dict = {}

        for result in retro_results:
            
            # canonicalize the outcome
            cano_outcome = canonicalize_smiles(result["outcome"])

            result.pop("outcome")

            reactants_split = cano_outcome.split(".")
            if any(smi in banned_chemicals for smi in reactants_split):
                continue

            reaction_smi = cano_outcome + ">>" + smiles
            cano_rxn_smi = cano_outcome + ">>" + cano_smiles
            
            if reaction_smi in banned_reactions or cano_rxn_smi in banned_reactions:
                continue

            if cano_outcome == cano_smiles:
                continue

            if cano_outcome in results_dict:
                results_dict[cano_outcome]["average_model_score"] \
                    += result["normalized_model_score"]/len(retro_backend_options)
                results_dict[cano_outcome]["model_metadata"].append(result)
            else:
                results_dict[cano_outcome] = {
                    "outcome": cano_outcome,
                    "average_model_score": result["normalized_model_score"]/len(retro_backend_options),
                    "model_metadata": [result], 
                    "precursor_properties": {},
                    "reaction_properties": {
                        "canonical_reaction_smiles" : cano_rxn_smi
                    }
                }

        results = list(results_dict.values())
        uses_higher_level = any(
            option.retro_model_name in HIGHER_LEVEL_MODEL_NAMES
            for option in retro_backend_options
        )
        if uses_higher_level:
            processed_product = (
                self.abs_group_handler(smiles)
                if _has_abs_groups(smiles)
                else smiles
            )
            processed_precursors: Dict[str, str] = {}
            for _r in results:
                o = _r["outcome"]
                if o not in processed_precursors:
                    processed_precursors[o] = (
                        self.abs_group_handler(o)
                        if _has_abs_groups(o)
                        else o
                    )
        else:
            processed_product = smiles
            processed_precursors = {_r["outcome"]: _r["outcome"] for _r in results}
        reaction_smis = [
            f"{processed_precursors[r['outcome']]}>>{processed_product}" for r in results
        ]
        print_if_debug(f"dedup: {time.time() - start}", debug)
        # </deduplication>

        # <filtering>
        if use_fast_filter:
            start = time.time()
            plausibilities = self.fast_filter_batch(rxn_smiles=reaction_smis)
            print_if_debug(f"fast_filter: {time.time() - start}", debug)
        else:
            # hardcode to 1.0, since tree analysis still relies on these
            plausibilities = [1.0 for _ in reaction_smis]
        # something weird happening for fast_filter
        if not plausibilities:
            plausibilities = [0.5 for _ in reaction_smis]

        filtered_results = []
        for result, plausibility in zip(results, plausibilities):
            if plausibility < fast_filter_threshold:
                continue
            result["plausibility"] = plausibility
            filtered_results.append(result)
        # </filtering>

        # <pricing>
        start = time.time()
        fragment_price_cache: Dict[str, Tuple[float, str, str]] = {}
        _prefetch_exact_fragment_prices(
            [result["outcome"] for result in filtered_results],
            use_smarts=uses_higher_level,
            price_client=self.pricer,
            cache=fragment_price_cache,
        )
        for result in filtered_results:
            fragments = result["outcome"].split(".")
            per_frag = {}
            for frag in fragments:
                ppg, source, smiles_match = _price_fragment(
                    frag, use_smarts=uses_higher_level, cache=fragment_price_cache
                )
                entry: Dict[str, Any] = {"ppg": ppg, "source": source}
                if smiles_match:
                    entry["smiles_match"] = smiles_match
                per_frag[frag] = entry
            result["precursor_prices"] = per_frag
        print_if_debug(f"pricing: {time.time() - start}", debug)
        # </pricing>

        # <post-filter computation>
        start = time.time()
        processed_precursor_smiles = [
            processed_precursors[result["outcome"]] for result in filtered_results
        ]
        scscore_batch_result = self.scscorer_batch(
            smiles_list=processed_precursor_smiles
        )

        for result, pre_smi in zip(filtered_results, processed_precursor_smiles):
            # start = time.time()
            result["rms_molwt"] = rms_molecular_weight(pre_smi)
            # print_if_debug(f"rms_molecular_weight: {time.time() - start}", debug)

            # start = time.time()
            result["num_rings"] = number_of_rings(pre_smi)
            # print_if_debug(f"number_of_rings: {time.time() - start}", debug)

            # start = time.time()
            result["scscore"] = scscore_batch_result[pre_smi]
            # print_if_debug(f"scscorer: {time.time() - start}\n", debug)
            # scscore is the culprit; 50x the time of the other two
        print_if_debug(f"post-filter computation: {time.time() - start}", debug)
        # </post-filter computation>


        # <template extraction>
        start = time.time()
        if extract_template or selectivity_check:
            for result in filtered_results:

                if "mapped_smiles" not in result:
                    rxn_smi = result["outcome"] + ">>" + smiles
                    res_atom_mapper = self.atom_mapper(
                        smiles=[rxn_smi],
                        backend=atom_map_backend
                    )
                    mapped_rxn_smi = res_atom_mapper[0] if res_atom_mapper else ""
                    result["mapped_smiles"] = mapped_rxn_smi

                reactants, _, products = result["mapped_smiles"].split(">")
                reaction = {
                    '_id': -1,
                    'reactants': reactants,
                    'products': products
                }
                try:
                    template = extract_from_reaction(reaction)
                except:
                    template = {}
                if (
                    "reaction_smarts" not in template
                    or not template["reaction_smarts"]
                ):
                    template["reaction_smarts"] = "failed_extraction"

                for k in [
                    "reactants_smarts",
                    "products_smarts",
                    "reaction_smarts_forward",
                    "reaction_smarts_retro",
                    "reactants",
                    "products"
                ]:
                    template.pop(k, None)
                result["template"] = template
        print_if_debug(f"extract: {time.time() - start}", debug)
        # </template extraction>

        # <reacting atoms computation>
        start = time.time()
        if return_reacting_atoms:
            if all("reacting_atoms" in result for result in filtered_results):
                pass
            else:
                if all("mapped_smiles" in result for result in filtered_results):
                    pass
                else:
                    # force remap all if not all mapped, with a batch call
                    rxn_smis_to_map = [
                        result["outcome"] + ">>" + smiles
                        for result in filtered_results
                    ]
                    mapped_rxn_smis = self.atom_mapper(
                        smiles=rxn_smis_to_map,
                        backend=atom_map_backend
                    )
                    for result, mapped_rxn_smi in zip(
                        filtered_results, mapped_rxn_smis
                    ):
                        if mapped_rxn_smi:
                            result["mapped_smiles"] = mapped_rxn_smi
                        else:
                            result["mapped_smiles"] = ""

                remapped_prod = None

                for result in filtered_results:
                    if result["mapped_smiles"]:
                        # print("----------mapped_smiles----------")
                        # print(result["mapped_smiles"])
                        reacting_atoms = get_reacting_atoms(result["mapped_smiles"])
                        # print("----------reacting_atoms----------")
                        # print(reacting_atoms)

                        # Reverse mapping as atom_mapper will canonicalize the product SMILES
                        # The reacting_atoms returned correspond to the indices in the
                        # canonical SMILES; need to map them back into the original SMILES

                        # DO NOT use CanonicalRankAtoms; this is something different
                        # canonical_rank = tuple(Chem.CanonicalRankAtoms(mol))
                        # canonical_rank: (1, 2, 6, 10, 7, 8, 3, 5, 9, 4, 0)
                        # canonical_rank_inverted = tuple(zip(
                        #     *sorted((j, i) for i, j in enumerate(canonical_rank))
                        # ))[1]
                        # canonical_rank_inverted: (10, 0, 1, 6, 9, 7, 2, 4, 5, 8, 3)
                        output_order = mol.GetProp('_smilesAtomOutputOrder')
                        # output_order: something like '[0,1,2,3,]'
                        # output_order = eval(output_order)

                        # This is very stupid but Snyk doesn't like eval()
                        # had to switch to the below logic, essentially equivalent to eval
                        output_order = [
                            int(c)
                            for c in output_order.lstrip("[").rstrip("]").split(",")
                            if c
                        ]

                        # print("----------output_order----------")
                        # print(output_order)

                        # SMILES: C1=CC=C2C=C(C=CC2=C1)OCC
                        # canonical SMILES: CCOc1ccc2ccccc2c1
                        # output_order: [12,11,10,5,6,7,8,9,0,1,2,3,4,]

                        # Raw reacting_atom 3 corresponds to the O
                        # (with an atom mapping no. of 3 in canonical SMILES),
                        # which has a no. of 11 in the original SMILES.
                        # So we need to convert "3" to "11"

                        reacting_atoms = [output_order[a-1] + 1 for a in reacting_atoms]
                        # The -1 and +1 is just converting between 0- and 1- indexed

                        # print("----------reacting_atoms----------")
                        # print(reacting_atoms)

                        result["reacting_atoms"] = reacting_atoms

                        mapped_reacts, _, mapped_prod = result["mapped_smiles"].split(">")
                        # Reset the mappings for the reactant SMILES too
                        r_mol = Chem.MolFromSmiles(mapped_reacts)
                        for a in r_mol.GetAtoms():
                            atom_map_num = a.GetAtomMapNum()
                            if atom_map_num > 0:
                                a.SetAtomMapNum(output_order[atom_map_num-1] + 1)

                        if not remapped_prod:
                            p_mol = Chem.MolFromSmiles(mapped_prod)
                            for a in p_mol.GetAtoms():
                                atom_map_num = a.GetAtomMapNum()
                                if atom_map_num > 0:
                                    a.SetAtomMapNum(output_order[atom_map_num-1] + 1)
                            remapped_prod = Chem.MolToSmiles(p_mol)

                        result["mapped_smiles"] = Chem.MolToSmiles(r_mol) + ">>" + remapped_prod
                        # print("----------mapped_smiles----------")

                    else:
                        result["reacting_atoms"] = []
        print_if_debug(f"return react: {time.time() - start}", debug)
        # </reacting atoms computation>

        # <selectivity check>
        start = time.time()
        if selectivity_check:
            for result in filtered_results:
                template = result["template"]["reaction_smarts"]
                if template == "failed_extraction":
                    continue

                mapped_products, mapped_precursors = apply_one_template_to_precursors(
                    precursors=result["outcome"],
                    template=template
                )
                if mapped_products and cano_smiles not in mapped_products:
                    # We couldn't recover the original product for some reason
                    result["selec_error"] = True
                    continue

                # Look for other products besides the target with the same number of heavy atoms
                product_atom_count = Chem.MolFromSmiles(smiles).GetNumHeavyAtoms()
                other_products = [
                    x for x in mapped_products
                    if x != cano_smiles
                    and Chem.MolFromSmiles(x).GetNumHeavyAtoms() == product_atom_count
                ]

                if len(other_products) > 0:
                    result["outcomes"] = ".".join(
                        [smiles] + [x for x in other_products]
                    )
                    result["mapped_outcomes"] = ".".join(
                        [mapped_products[smiles]]
                        + [mapped_products[x] for x in other_products]
                    )
                    result["mapped_precursors"] = mapped_precursors
        print_if_debug(f"selec check: {time.time() - start}", debug)
        # </selectivity check>

        # <rerank>
        start = time.time()
        if retro_rerank_backend == "relevance_heuristic":
            reranked_results = self._rerank_by_relevance_heuristic(
                filtered_results, fragment_price_cache
            )
        elif retro_rerank_backend == "scscore":
            reranked_results = self._rerank_by_scscore(filtered_results)
        else:
            print(f"retro_rerank_backend: {retro_rerank_backend} not supported! "
                  f"Returning results based on normalized_model_score")
            reranked_results = self._rerank_default(filtered_results)
        print_if_debug(f"rerank: {time.time() - start}", debug)
        # </rerank>

        # <cluster>
        start = time.time()
        if cluster_precursors:
            if max_num_for_clustering:
                reranked_results = reranked_results[:max_num_for_clustering]
            cluster_ids, names = self.clusterer(
                original=smiles,
                outcomes=[result["outcome"] for result in reranked_results],
                scores=[result["precursor_score"] for result in reranked_results],
                cluster_setting=cluster_setting
            )
            for result, cluster_id in zip(reranked_results, cluster_ids):
                result["cluster_id"] = cluster_id
                try:
                    result["cluster_name"] = names[str(cluster_id)]
                except KeyError:
                    result["cluster_name"] = names[cluster_id]
        print_if_debug(f"cluster: {time.time() - start}", debug)
        # </cluster>

        for result in reranked_results:
            if "mapped_smiles" not in result:
                result["mapped_smiles"] = ""
            if "reacting_atoms" not in result:
                result["reacting_atoms"] = []

        # <final formatting>
        start = time.time()
        for result in reranked_results:
            for k in list(result.keys()):
                if k not in FINAL_RESULT_KEYS:
                    if k in PRECURSOR_PROPS:
                        result["precursor_properties"][k] = result.pop(k)
                    else:
                        result["reaction_properties"][k] = result.pop(k)

        return reranked_results

    @staticmethod
    def _rerank_default(filtered_results: List[Dict[str, Any]]
                           ) -> List[Dict[str, Any]]:
        for result in filtered_results:
            result["precursor_score"] = result["average_model_score"]

        reranked_results = sorted(
            filtered_results,
            key=lambda d: d["precursor_score"],
            reverse=True
        )

        for rank, result in enumerate(reranked_results, start=1):
            result["precursor_rank"] = rank

        return reranked_results

    def _rerank_by_relevance_heuristic(
        self,
        filtered_results: List[Dict[str, Any]],
        fragment_prices: Dict[str, Tuple[float, str, str]],
    ) -> List[Dict[str, Any]]:
        # Build ppg-only lookup (fragment -> ppg) for the relevance function
        frag_ppg = {frag: v[0] for frag, v in fragment_prices.items()}

        tasks = []
        for result in filtered_results:
            try:
                necessary_reagent = result["template"]["necessary_reagent"]
            except (KeyError, TypeError):
                necessary_reagent = ""
            
            average_model_score = result["average_model_score"]

            tasks.append((
                result["outcome"], necessary_reagent,
                average_model_score, frag_ppg
            ))

        scores = self.p.imap(_get_relevance, tasks)
        for result, score in zip(filtered_results, scores):
            result["precursor_score"] = score

        reranked_results = sorted(
            filtered_results,
            key=lambda d: d["precursor_score"],
            reverse=True
        )

        for rank, result in enumerate(reranked_results, start=1):
            result["precursor_rank"] = rank

        return reranked_results

    @staticmethod
    def _rerank_by_scscore(filtered_results: List[Dict[str, Any]]
                           ) -> List[Dict[str, Any]]:
        for result in filtered_results:
            result["precursor_score"] = result["scscore"]

        reranked_results = sorted(
            filtered_results,
            key=lambda d: d["precursor_score"],
            reverse=False
        )

        for rank, result in enumerate(reranked_results, start=1):
            result["precursor_rank"] = rank

        return reranked_results
