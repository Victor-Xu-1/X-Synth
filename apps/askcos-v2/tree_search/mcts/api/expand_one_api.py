import time
from packages.adapters.askcos.native_http import NativeProtocolError, NativeSession, post_json
from packages.platform.performance import PerformanceBudget
from options import ClusterSetting, ExpandOneOptions, RetroBackendOption
from pydantic import BaseModel, Field
from typing import Dict, List, Optional


class ModelMetadata(BaseModel):
    direction: str
    backend: str
    model_name: str
    attributes: dict
    model_score: float
    normalized_model_score: float
    rank: int
    reaction_id: Optional[str] = None
    reaction_set: Optional[str] = None
    source: dict


class ModelReactionProperties(BaseModel):
    canonical_reaction_smiles: str
    mapped_smiles: Optional[str] = None
    plausibility: float
    reacting_atoms: list[int] = Field(default_factory=list)
    selec_error: Optional[bool] = None


class RetroResult(BaseModel):
    # from retro_controller
    average_model_score: float
    model_metadata: list[ModelMetadata]
    outcome: str
    precursor_properties: dict
    precursor_rank: int
    precursor_score: float
    reaction_properties: ModelReactionProperties


class ExpandOneInput(BaseModel):
    # mirroring the (default) wrapper; convenient to turn into a client library
    smiles: str
    retro_backend_options: List[RetroBackendOption] = [RetroBackendOption()]
    banned_chemicals: List[str] = None
    banned_reactions: List[str] = None
    use_fast_filter: bool = True
    fast_filter_threshold: float = 0.75
    retro_rerank_backend: Optional[str] = None
    atom_map_backend: str = "rxnmapper"
    cluster_precursors: bool = False
    cluster_setting: Optional[ClusterSetting] = None
    extract_template: bool = False
    return_reacting_atoms: bool = False
    selectivity_check: bool = False


class ExpandOneResponse(BaseModel):
    # mirroring the (default) wrapper, but without BaseResponse (semi-hardcode)
    status_code: int
    message: str
    result: List[RetroResult]


class ExpandOneBackendError(NativeProtocolError):
    """Raised when expand-one is unavailable rather than chemically empty."""


class ExpandOneAPI:
    """ExpandOne API to be used as a one-step expansion engine"""
    def __init__(
        self,
        default_url: str,
        request_timeout: float | None = None,
    ):
        self.default_url = default_url
        self.request_timeout = PerformanceBudget.from_environment().expansion_timeout_seconds if request_timeout is None else request_timeout
        self.session = NativeSession()

    def __call__(
        self,
        smiles: str,
        expand_one_options: ExpandOneOptions,
        url: str = None,
        *,
        cancel_event=None,
        deadline=None,
    ) -> Optional[List[Dict[str, any]]]:
        if not url:
            url = self.default_url

        # Modify the overriding logic to apply only if not provided for each option
        for option in expand_one_options.retro_backend_options:
            if not option.max_num_templates and expand_one_options.template_max_count:
                option.max_num_templates = expand_one_options.template_max_count
            if not option.max_cum_prob and expand_one_options.template_max_cum_prob:
                option.max_cum_prob = expand_one_options.template_max_cum_prob

        cluster_setting = expand_one_options.cluster_setting
        if cluster_setting is not None:
            cluster_setting = cluster_setting.model_dump()

        input = {
            "smiles": smiles,
            "retro_backend_options": [
                option.model_dump() for option in expand_one_options.retro_backend_options
            ],
            "banned_chemicals": expand_one_options.banned_chemicals,
            "banned_reactions": expand_one_options.banned_reactions,
            "use_fast_filter": expand_one_options.use_fast_filter,
            "fast_filter_threshold": expand_one_options.filter_threshold,
            "retro_rerank_backend": expand_one_options.retro_rerank_backend,
            "atom_map_backend": expand_one_options.atom_map_backend,
            "cluster_precursors": expand_one_options.cluster_precursors,
            "cluster_setting": cluster_setting,
            "extract_template": expand_one_options.extract_template,
            # Tree search always disables atom mapping / reacting-atom computation
            # regardless of expand_one_options.return_reacting_atoms
            "return_reacting_atoms": False,
            "selectivity_check": expand_one_options.selectivity_check
        }
        # additional validation. Sending null/none value to FastAPI seems to
        # fail the validation check and break the defaulting mechanism
        input = {k: v for k, v in input.items() if v is not None}

        ExpandOneInput(**input)
        call_deadline = time.monotonic() + self.request_timeout
        try:
            response = post_json(
                self.session, url, payload=input, response_model=ExpandOneResponse,
                timeout=self.request_timeout, cancel_event=cancel_event,
                deadline=min(deadline, call_deadline) if deadline is not None else call_deadline,
            )
        except NativeProtocolError as exc:
            raise ExpandOneBackendError("Expand-one request failed", code=exc.code, recoverable=exc.recoverable) from exc
        return response["result"]
