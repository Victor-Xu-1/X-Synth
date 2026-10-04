"""Graph distances without a checkout-local compiled shared library."""

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import shortest_path


class DistanceCalculator:
    @staticmethod
    def calculate(adjacency: np.ndarray, a_length: int, max_distance: int) -> np.ndarray:
        if adjacency.shape != (a_length, a_length):
            raise ValueError("Invalid Graph2SMILES graph distance input")
        distances = shortest_path(csr_matrix(adjacency), directed=True, unweighted=True)
        valid = np.isfinite(distances) & (distances <= max_distance)
        return np.where(valid, distances, 0).astype(np.int32)
