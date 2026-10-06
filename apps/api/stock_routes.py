from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from packages.adapters.stock.catalog_pricing import priced_lookup
from packages.adapters.stock.commercial_stock import canonicalize_smiles
from packages.adapters.stock.stock_index import StockIndexError

from .security import authenticate


class StockLookup(BaseModel):
    smiles: list[str] = Field(min_length=1, max_length=5000)

    @field_validator("smiles")
    @classmethod
    def valid_structures(cls, values):
        if any(
            len(value) > 20000 or not canonicalize_smiles(value) for value in values
        ):
            raise ValueError("Stock lookup requires valid molecular structures")
        return values


def stock_router(*, stock, transport):
    router = APIRouter()

    @router.post("/stock/lookup")
    def lookup(body: StockLookup, request: Request):
        authenticate(request, transport)
        if stock is None:
            raise HTTPException(503, "Commercial inventory snapshot is not configured")
        try:
            response = priced_lookup(stock.lookup_many(body.smiles), stock.summary)
        except StockIndexError as exc:
            raise HTTPException(503, "商业库存快照已变化或暂不可用，请恢复已配置的数据源。") from exc
        response["requested"] = [
            {"smiles": smiles, "canonical_smiles": canonicalize_smiles(smiles)}
            for smiles in body.smiles
        ]
        return response

    return router
