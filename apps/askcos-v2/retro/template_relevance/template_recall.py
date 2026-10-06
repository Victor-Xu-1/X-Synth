"""Bound ranked templates; probability one explicitly disables the cutoff."""

import numpy as np


def truncate_templates(indices, scores, max_num_templates, max_cum_prob):
    if max_num_templates:
        indices, scores = indices[:max_num_templates], scores[:max_num_templates]
    if max_cum_prob and max_cum_prob < 1.0:
        exceeds = np.nonzero(np.cumsum(scores) >= max_cum_prob)[0]
        if exceeds.size:
            end = exceeds[0] + 1
            indices, scores = indices[:end], scores[:end]
    return indices, scores
