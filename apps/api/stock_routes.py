from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from packages.adapters.stock.commercial_stock import canonicalize_smiles

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
        return {
            "snapshot": stock.summary["source_sha256"],
            "results": stock.lookup_many(body.smiles),
        }

    return router
