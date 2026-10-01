import copy
import numpy as np
import pickle
import sys
from multiprocessing import cpu_count
import concurrent.futures
from pebble import ProcessPool
from route.network import ReactionNetwork
from route.search import NetworkSearcher
from route.utils import smi_to_fp
from model.parse_args import parser


def train_network_search(input):
    i, node = input
    if i % 100000 == 0: print(f"Processing {i} node")
    global building_blocks
    global train_network
    searcher = NetworkSearcher(node)
    graph, result = searcher.run_search(train_network, building_blocks)
    if result:
        return i, node, graph, result, searcher
    else:
        return i, None, None, None, None
    
def val_network_search(input):
    i, node = input
    if i % 100000 == 0: print(f"Processing {i} node")
    global building_blocks
    global val_network
    searcher = NetworkSearcher(node)
    graph, result = searcher.run_search(val_network, building_blocks)
    if result:
        return i, node, graph, result, searcher
    else:
        return i, None, None, None, None


if __name__ == "__main__":
    args = parser.parse_args()
    # Load reactions from TRAIN_RXNS_PATH
    with open(args.train_file, "r") as f:
        train_rxns = f.readlines()
    print("Loaded training reaction set with {} reactions".format(len(train_rxns)))

    # Load building blocks from VAL_RXNS_PATH
    with open(args.val_file, "r") as f:
        val_rxns = f.readlines()
    print("Loaded validation reaction set with {} reactions".format(len(val_rxns)))

    # Load building blocks from BB_PATH
    with open(args.bb_file, "rb") as f:
        building_blocks = pickle.load(f)
    print(
        "Loaded building block set with {} building blocks".format(len(building_blocks))
    )

    # Populate the reaction network with loaded reactions
    train_network = ReactionNetwork()
    num_nodes, num_edges = train_network.populate_network(train_rxns)
    print(
        "Populated training network with {} nodes and {} edges".format(
            num_nodes, num_edges
        )
    )
    val_network = copy.deepcopy(train_network)
    num_nodes, num_edges = val_network.populate_network(val_rxns)
    print(
        "Populated validation network with {} nodes and {} edges".format(
            num_nodes, num_edges
        )
    )
    # Get unbuyable nodes
    unbuyable_nodes = train_network.get_unbuyable(building_blocks)
    unbuyable_val = val_network.get_unbuyable(building_blocks)
    unbuyable_val = list(set(unbuyable_val) - set(unbuyable_nodes))
    print("Number unbuyable nodes for train: {} val: {}".format(len(unbuyable_nodes), len(unbuyable_val)))

    """
    TRAINING DATA GENERATION
    .npz file has the following arrays
        1. fps - fingerprints of molecule
        2. values - total values of molecule  
        3. r_costs - costs of alternate reactions (1 if exists)
        4. r_fps - fingerprints of alternate reactants
        5. r_masks - masks to identify alternate reactants in padded array
    """
    FP_SIZE = 2048
    fps = []
    values = []
    r_costs = []
    r_fps_array = []
    r_masks = []
    counter = 0

    with ProcessPool(max_workers=cpu_count()) as pool:
        # Using pebble to add timeout, as rdchiral could hang
        future = pool.map(train_network_search, ((i, node) for i, node in enumerate(unbuyable_nodes)), timeout=5)
        iterator = future.result()

    while True:
        try: 
            i, node, graph, result, searcher = next(iterator)
            if result:
                fp = smi_to_fp(node)
                value = searcher.target.reaction_number
                # If there are alternate reactants, add negative examples to the data
                if any(
                    child.reaction_number > value
                    for child in graph.successors(searcher.target)
                ):
                    for child in graph.successors(searcher.target):
                        if child.reaction_number > value:
                            r_cost = 1
                            r_fps = []
                            for reactant in graph.successors(child):
                                r_fps.append(smi_to_fp(reactant.smiles))
                            fps.append(fp)
                            values.append(value)
                            r_costs.append(r_cost)
                            r_fps_array.append(r_fps)
                            r_masks.append([[1] * FP_SIZE] * len(r_fps))
                            counter += 1
                else:
                    fps.append(fp)
                    values.append(value)
                    r_costs.append(np.inf)
                    r_fps_array.append([])
                    r_masks.append([])
        except StopIteration:
            break
        except concurrent.futures.TimeoutError:
            print(f"TImeout idx: {i}")
        except:
            print(f"Others idx: {i}")
    fps = np.array(fps)
    values = np.array(values)
    r_costs = np.array(r_costs)
    r_fps_padded = np.zeros(
        (len(r_fps_array), max([len(x) for x in r_fps_array]), FP_SIZE),
        dtype=int
    )
    r_masks_padded = np.zeros(
        (len(r_fps_array), max([len(x) for x in r_fps_array]), FP_SIZE),
        dtype=int
    )
    for i, (r_fp, r_mask) in enumerate(zip(r_fps_array, r_masks)):
        if len(r_fp) > 0:
            r_fps_padded[i, : len(r_fp)] = r_fp
            r_masks_padded[i, : len(r_mask)] = r_mask
    
    fps = np.packbits(fps, axis=-1)
    r_fps_padded = np.packbits(r_fps_padded, axis=-1)
    r_masks_padded = np.packbits(r_masks_padded, axis=-1)
    
    print("Generated {} negative data points".format(counter))
    print("Generated training data with shapes:")
    print("\tfps:", fps.shape)
    print("\tvalues:", values.shape)
    print("\tr_costs:", r_costs.shape)
    print("\tr_fps:", r_fps_padded.shape)
    print("\tr_masks:", r_masks_padded.shape)

    # Save the training data to TRAIN_OUT_PATH
    with open(f"{args.processed_folder}/train_out.npz", "wb") as f:
        np.savez(
            f,
            fps=fps,
            values=values,
            r_costs=r_costs,
            r_fps=r_fps_padded,
            r_masks=r_masks_padded,
        )
    print(f"Saved training data to {args.processed_folder}/train_out.npz")


    """
    VALIDATION DATA GENERATION
    """
    fps = []
    values = []
    r_costs = []
    r_fps_array = []
    r_masks = []
    counter = 0

    with ProcessPool(max_workers=cpu_count()) as pool:
        # Using pebble to add timeout, as rdchiral could hang
        future = pool.map(val_network_search, ((i, node) for i, node in enumerate(unbuyable_val)), timeout=5)
        iterator = future.result()

    while True:
        try: 
            i, node, graph, result, searcher = next(iterator)
            if result:
                fp = smi_to_fp(node)
                value = searcher.target.reaction_number
                # If there are alternate reactants, add negative examples to the data
                if any(
                    child.reaction_number > value
                    for child in graph.successors(searcher.target)
                ):
                    for child in graph.successors(searcher.target):
                        if child.reaction_number > value:
                            r_cost = 1
                            r_fps = []
                            for reactant in graph.successors(child):
                                r_fps.append(smi_to_fp(reactant.smiles))
                            fps.append(fp)
                            values.append(value)
                            r_costs.append(r_cost)
                            r_fps_array.append(r_fps)
                            r_masks.append([[1] * FP_SIZE] * len(r_fps))
                            counter += 1
                else:
                    fps.append(fp)
                    values.append(value)
                    r_costs.append(np.inf)
                    r_fps_array.append([])
                    r_masks.append([])
        except StopIteration:
            break
        except concurrent.futures.TimeoutError:
            print(f"Timeout idx: {i}")
        except:
            print(f"Others idx: {i}")
    fps = np.array(fps)
    values = np.array(values)
    r_costs = np.array(r_costs)
    r_fps_padded = np.zeros(
        (len(r_fps_array), max([len(x) for x in r_fps_array]), FP_SIZE),
        dtype=int
    )
    r_masks_padded = np.zeros(
        (len(r_fps_array), max([len(x) for x in r_fps_array]), FP_SIZE),
        dtype=int
    )
    for i, (r_fp, r_mask) in enumerate(zip(r_fps_array, r_masks)):
        if len(r_fp) > 0:
            r_fps_padded[i, : len(r_fp)] = r_fp
            r_masks_padded[i, : len(r_mask)] = r_mask
    
    fps = np.packbits(fps, axis=-1)
    r_fps_padded = np.packbits(r_fps_padded, axis=-1)
    r_masks_padded = np.packbits(r_masks_padded, axis=-1)
    
    print("Generated {} negative data points".format(counter))
    print("Generated training data with shapes:")
    print("\tfps:", fps.shape)
    print("\tvalues:", values.shape)
    print("\tr_costs:", r_costs.shape)
    print("\tr_fps:", r_fps_padded.shape)
    print("\tr_masks:", r_masks_padded.shape)

    # Save the training data to VAL_OUT_PATH
    with open(f"{args.processed_folder}/val_out.npz", "wb") as f:
        np.savez(
            f,
            fps=fps,
            values=values,
            r_costs=r_costs,
            r_fps=r_fps_padded,
            r_masks=r_masks_padded,
        )
    print(f"Saved validation data to {args.processed_folder}/val_out.npz")