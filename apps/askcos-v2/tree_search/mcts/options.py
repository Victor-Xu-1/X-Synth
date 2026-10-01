from pydantic import BaseModel, Field
from typing import Any, Dict, List, Literal, Optional, Union


class RetroBackendOption(BaseModel):
    retro_backend: str = "template_relevance"
    retro_model_name: str = "reaxys"
    max_num_templates: int = 1000
    max_cum_prob: float = 0.999
    attribute_filter: List[Dict[str, Any]] = []

    # For retrosim only
    threshold: float = 0.3
    top_k: int = 10


class ClusterSetting(BaseModel):
    feature: str = "original"
    cluster_method: str = "rxn_class"
    fp_type: str = "morgan"
    fp_length: int = 512
    fp_radius: int = 1
    classification_threshold: float = 0.2


class ExpandOneOptions(BaseModel):
    # aliasing to v1 fields
    template_max_count: int = Field(default=1000, alias="template_count")
    template_max_cum_prob: float = Field(default=0.999, alias="max_cum_template_prob")
    banned_chemicals: List[str] = Field(default=[], alias="forbidden_molecules")
    banned_reactions: List[str] = Field(default=[], alias="known_bad_reactions")

    retro_backend_options: List[RetroBackendOption] = [RetroBackendOption()]
    use_fast_filter: bool = True
    filter_threshold: float = 0.75
    retro_rerank_backend: str | None = None
    atom_map_backend: str = "rxnmapper"
    cluster_precursors: bool = True
    cluster_setting: ClusterSetting = None
    extract_template: bool = False
    return_reacting_atoms: bool = False
    selectivity_check: bool = False

    class Config:
        allow_population_by_field_name = True


class BuildTreeOptions(BaseModel):
    expansion_time: int = 1200
    max_iterations: Optional[int] = None
    max_chemicals: Optional[int] = None
    max_reactions: Optional[int] = None
    max_templates: Optional[int] = None
    max_branching: int = 50
    max_depth: int = 12
    exploration_weight: float = 1.0
    return_first: bool = False
    max_trees: int = 200
    max_ppg: Optional[float] = None
    max_scscore: Optional[float] = None
    max_elements: Optional[Dict[str, int]] = None
    min_history: Optional[Dict[str, int]] = None
    property_criteria: Optional[List[Dict[str, Any]]] = None
    termination_logic: Optional[Dict[str, List[str]]] = {"and": ["buyable"]}
    buyables_source: Optional[Union[str, List[str]]] = None
    custom_buyables: Optional[List[str]] = None


class EnumeratePathsOptions(BaseModel):
    path_format: Literal["json", "graph"] = "json"
    json_format: Literal["treedata", "nodelink"] = "nodelink"
    sorting_metric: Literal[
        "plausibility",
        "number_of_starting_materials",
        "number_of_reactions",
        "score"
    ] = "score"
    validate_paths: bool = True
    score_trees: bool = True
    cluster_trees: bool = True
    cluster_method: Literal["hdbscan", "kmeans"] = "hdbscan"
    min_samples: int = 5
    min_cluster_size: int = 5
    paths_only: bool = False
    max_paths: int = 10
