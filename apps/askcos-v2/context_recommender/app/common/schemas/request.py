from pydantic import BaseModel
from typing import List, Optional

from app.common.schemas.condition import ConditionRecommendation


class RecommendConditionRequest(BaseModel):
    smiles: str
    reagents: Optional[List[str]] = None
    n_conditions: int = 10


class RecommendConditionResponse(List[ConditionRecommendation]):
    pass
