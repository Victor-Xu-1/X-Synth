import hdbscan
import numpy as np
import os
import rdkit.Chem as Chem
import sklearn.cluster as cluster
from api.get_top_class_batch_api import GetTopClassBatchAPI
from rdkit.Chem import AllChem
from typing import Dict, List, Tuple

GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://0.0.0.0:9100")
get_top_class_batch = GetTopClassBatchAPI(
    url=f"{GATEWAY_URL}/api/get-top-class-batch/call-sync"
)


def group_results(
    original: str,
    outcomes: List[str],
    feature: str = "original",
    cluster_method: str = "kmeans",
    fp_type: str = "morgan",
    fp_length: int = 512,
    fp_radius: int = 1,
    scores: List[float] = None,
    classification_threshold: float = 0.2
) -> Tuple[List[int], Dict[str, str]]:
    """
    Cluster the similar transformed outcomes together

    Args:
        original (str): SMILES string of original target molecule
        outcomes (list of str):
            List containing SMILES strings of outcomes to be clustered
        feature (str, optional):
            Only use features disappearing from 'original', appearing in 'outcomes'
            or a combination of 'all'. (default: {'original'})
        cluster_method (str, optional):
            Method to use for clustering ['kmeans', 'hbdscan', 'rxn_class']
            (default: {'kmeans'})
        fp_type (str, optional):
            Type of fingerprinting method to use. (default: {'morgan'})
        fp_length (int, optional):
            Fixed-length folding of fingerprint. (default: {512})
        fp_radius (int, optional): Radius to use for fingerprint. (default: {1})
        scores (list of float, optional):
            List of precursor outcome scores to number clusters i.e.,
            cluster 1 contains precursor outcome with best score. (default: {None})
        classification_threshold (float, optional):
            The threshold to classify a reaction as unknown when using the
            rxn_class clustering method (default: 0.2)
    Returns:
        list of int: Cluster indices for outcomes, 0-based
        dictionary: Map from cluster IDs to cluster Name
    """
    if fp_type == "morgan":
        def fp_generator(_smi):
            return AllChem.GetMorganFingerprintAsBitVect(
                Chem.MolFromSmiles(_smi), fp_radius, nBits=fp_length
            )
    else:
        raise Exception(
            f"Fatal error: fingerprint type {fp_type} is not supported."
        )

    if not outcomes:
        return [], {}

    # calculate fingerprint
    original_fp = np.array(fp_generator(original))
    outcomes_fp = np.array([fp_generator(i) for i in outcomes])

    diff_fp = original_fp - outcomes_fp

    if feature == "original":
        diff_fp = diff_fp.clip(min=0)
    elif feature == "outcomes":
        diff_fp = diff_fp.clip(max=0)
    elif feature == "all":
        pass
    else:
        raise Exception("Fatal error: feature={} is not recognized.".format(feature))

    # calculate cluster indices
    if cluster_method == "hdbscan":
        clusterer = hdbscan.HDBSCAN(min_cluster_size=5, gen_min_span_tree=False)
        clusterer.fit(diff_fp)
        res = clusterer.labels_
        # non-clustered inputs have id -1, make them appear as individual clusters
        max_cluster = np.amax(res)
        for i in range(len(res)):
            if res[i] == -1:
                max_cluster += 1
                res[i] = max_cluster
    elif cluster_method == "kmeans":
        for cluster_size in range(len(diff_fp)):
            kmeans = cluster.KMeans(n_clusters=cluster_size+1).fit(diff_fp)
            if kmeans.inertia_ < 1:
                break
        res = kmeans.labels_
    elif cluster_method == "rxn_class":
        reactions = [f"{precursor}>>{original}" for precursor in outcomes]
        class_nums_and_names = get_top_class_batch(
            smiles_list=reactions,
            threshold=classification_threshold
        )

        # Generate mapping from reaction classification ID to cluster IDs.
        # Sort such that the lowest cluster ID corresponds to the lowest
        # numeric reaction classification ID. Sort key first checks the number
        # before the decimal point (the superclass). If those are equal, it
        # then tiebreaks on the numeric value of the subclass
        # Example: ["1.1", "3.11", "3.2", "3.10", "11.3", "12.3"]
        # -> ["1.1", "3.2", "3.10", "3.11", "11.3", "12.3"]
        all_cluster_nums = sorted(
            {rxn[0] for rxn in class_nums_and_names},
            key=lambda x: (float(x[: x.find(".")]), float(x[x.find(".") + 1 :])),
        )
        cluster_nums_to_id = {num: i for i, num in enumerate(all_cluster_nums)}

        # change all results to be actual assigned cluster ID
        res = [cluster_nums_to_id[num] for num, name in class_nums_and_names]
        name_dict = {
            cluster_nums_to_id[num]: str(num) + ": " + name
            for num, name in class_nums_and_names
        }
        return res, name_dict

    else:
        raise Exception(
            f"Fatal error: cluster_method={cluster_method} is not recognized."
        )
    res = [int(i) for i in res]

    if scores is not None:
        if len(scores) != len(res):
            raise Exception(
                f"Fatal error: length of score ({len(scores)}) "
                f"and smiles ({len(res)}) are different."
            )
        best_cluster_score = {}
        for cluster_id, score in zip(res, scores):
            best_cluster_score[cluster_id] = max(
                best_cluster_score.get(cluster_id, -float("inf")), score
            )
        print(f"best_cluster_score: {best_cluster_score}")
        new_order = list(sorted(best_cluster_score.items(), key=lambda x: -x[1]))
        order_mapping = {new_order[n][0]: n for n in range(len(new_order))}
        print(f"order_mapping: {order_mapping}")
        res = [order_mapping[n] for n in res]

    name_dict = {c: f"Reaction Cluster #{str(c + 1)}" for c in res}

    return res, name_dict
