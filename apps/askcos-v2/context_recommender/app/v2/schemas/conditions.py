from pydantic import BaseModel
from typing import Dict


class ReactionConditions(BaseModel):
    reagents: Dict[str, float]
    reactants: Dict[str, float]
    temperature: float
    reagents_score: float
