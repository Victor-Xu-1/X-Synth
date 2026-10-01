from enum import auto
from pydantic import BaseModel
from typing import List, Optional

from app.common.utils.utils import AutoName


class Role(AutoName):
    REACTANT = auto()
    REAGENT = auto()
    SOLVENT = auto()
    CATALYST = auto()
    UNKNOWN = auto()


class Agent(BaseModel):
    smi_or_name: Optional[str]
    role: Role = Role.UNKNOWN
    amt: Optional[float] = None


class ConditionRecommendation(BaseModel):
    agents: List[Agent]
    temperature: Optional[float]
    score: Optional[float]
