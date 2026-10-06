from packages.adapters.askcos.native_http import NativeProtocolError, NativeSession, post_json
from pydantic import BaseModel
from typing import Any, Dict, List, Optional


class RetroInput(BaseModel):
    # mirroring the wrappers; convenient to turn into a client library
    backend: str = "template_relevance"
    model_name: str = "reaxys"
    smiles: List[str]

    # For template_relevance only
    max_num_templates: int = 1000
    max_cum_prob: float = 0.999
    attribute_filter: Optional[List[Dict[str, Any]]] = []

    # For retrosim only
    threshold: float = 0.3
    top_k: int = 10


class RetroResult(BaseModel):
    outcome: str
    model_score: float
    template: Optional[Dict[str, Any]]
    reaction_data: Optional[Dict[str, Any]]


class RetroResponse(BaseModel):
    # mirroring the wrappers, but without BaseResponse (semi-hardcode)
    status_code: int
    message: str
    result: Optional[List[List[RetroResult]]]


class RetroAPI:
    """Retro API to be used as a one-step retrosynthesis proposer"""
    def __init__(self, default_url: str, default_backend: str):
        self.default_url = default_url
        self.default_backend = default_backend
        self.session = NativeSession()

    def __call__(
        self,
        smiles: List[str],
        url: str = None,
        backend: str = None,
        model_name: str = None,
        max_num_templates: int = 1000,
        max_cum_prob: float = 0.999,
        attribute_filter: List[Dict[str, Any]] = None,
        threshold: float = 0.3,
        top_k: int = 10
    ) -> List[List[Dict[str, Any]]]:
        if not url:
            url = self.default_url

        if not backend:
            backend = self.default_backend

        input = {
            "backend": backend,
            "model_name": model_name,
            "smiles": smiles,
            "max_num_templates": max_num_templates,
            "max_cum_prob": max_cum_prob,
            "attribute_filter": attribute_filter,
            "threshold": threshold,
            "top_k": top_k
        }

        RetroInput(**input)                         # merely validate the input
        response = post_json(self.session, url, payload=input, response_model=RetroResponse)

        result = response["result"]
        if result is None:
            raise NativeProtocolError(
                "Retrosynthesis backend returned no result batch",
                code="native_dependency_unavailable", recoverable=True,
            )
        if len(result) != len(smiles):
            raise NativeProtocolError("Retrosynthesis result batch does not match its inputs")

        return result
