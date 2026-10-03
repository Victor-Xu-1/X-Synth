import requests
from packages.adapters.askcos.native_http import NativeSession, post_json
from pydantic import BaseModel
from typing import Any, Dict, List, Optional


class PathwayRankerInput(BaseModel):
    trees: List[Dict]
    clustering: bool = False
    cluster_method: str = "hdbscan"
    min_samples: int = 5
    min_cluster_size: int = 5


class PathwayRankerResult(BaseModel):
    scores: list
    encoded_trees: list
    clusters: list | None


class PathwayRankerResponse(BaseModel):
    # mirroring the (default) wrapper, but without BaseResponse (semi-hardcode)
    status_code: int
    message: str
    result: PathwayRankerResult


class PathwayRankerAPI:
    """PathwayRanker API to be used as a pathway ranker"""
    def __init__(self, url: str):
        self.default_url = url
        self.session = NativeSession()

    def __call__(
        self,
        trees: List[Dict[str, Any]],
        url: str = None,
        clustering: bool = False,
        cluster_method: str = "hdbscan",
        min_samples: int = 5,
        min_cluster_size: int = 5
    ) -> Optional[Dict[str, List]]:
        if not url:
            url = self.default_url

        input = {
            "trees": trees,
            "clustering": clustering,
            "cluster_method": cluster_method,
            "min_samples": min_samples,
            "min_cluster_size": min_cluster_size
        }

        PathwayRankerInput(**input)             # merely validate the input
        response = post_json(self.session, url, payload=input, response_model=PathwayRankerResponse)

        result = response["result"]

        return result
