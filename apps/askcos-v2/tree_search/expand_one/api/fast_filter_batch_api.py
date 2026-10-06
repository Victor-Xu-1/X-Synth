from packages.adapters.askcos.native_http import NativeSession, post_json
from packages.adapters.askcos.native_service_limits import FAST_FILTER_BATCH_SIZE
from pydantic import BaseModel
from typing import List, Optional


class FastFilterBatchInput(BaseModel):
    # mirroring the (default) wrapper; convenient to turn into a client library
    rxn_smiles: List[str]


class FastFilterBatchResponse(BaseModel):
    # mirroring the (default) wrapper, but without BaseResponse (semi-hardcode)
    status_code: int
    message: str
    result: Optional[List[float]]


class FastFilterBatchAPI:
    """fast filter Batch API to be used as a fast filter for batch query"""
    def __init__(self, default_url: str):
        self.default_url = default_url
        self.session = NativeSession()

    def __call__(self, rxn_smiles: List[str], url: str = None
                 ) -> Optional[List[float]]:
        if not url:
            url = self.default_url

        FastFilterBatchInput(rxn_smiles=rxn_smiles)
        scores = []
        for offset in range(0, len(rxn_smiles), FAST_FILTER_BATCH_SIZE):
            batch = rxn_smiles[offset:offset + FAST_FILTER_BATCH_SIZE]
            response = post_json(self.session, url, payload={"rxn_smiles": batch}, response_model=FastFilterBatchResponse)
            values = response["result"]
            if values is None or len(values) != len(batch):
                raise ValueError("Fast-filter scores do not match the requested reactions")
            scores.extend(values)
        return scores
