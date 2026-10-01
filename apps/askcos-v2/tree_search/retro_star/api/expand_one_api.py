import requests
import time
from options import ClusterSetting, ExpandOneOptions, RetroBackendOption
from pydantic import BaseModel, Field, error_wrappers
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


class ExpandOneBackendError(RuntimeError):
    """Raised when expand-one is unavailable rather than chemically empty."""


class ExpandOneAPI:
    """ExpandOne API to be used as a one-step expansion engine"""
    def __init__(
        self,
        default_url: str,
        max_retries: int = 1,
        retry_delay: float = 2.0,
        request_timeout: float = 330.0,
    ):
        self.default_url = default_url
        self.max_retries = max(0, max_retries)
        self.retry_delay = max(0.0, retry_delay)
        self.request_timeout = request_timeout
        self.session = requests.Session()
        self.session.trust_env = False

    def __call__(
        self,
        smiles: str,
        expand_one_options: ExpandOneOptions,
        url: str = None
    ) -> Optional[List[Dict[str, any]]]:
        if not url:
            url = self.default_url

        # Overriding backend option fields if provided in expand_one_options
        retro_backend_options = expand_one_options.retro_backend_options
        # if expand_one_options.template_max_count:
        #     for option in expand_one_options.retro_backend_options:
        #         option.max_num_templates = expand_one_options.template_max_count
        # if expand_one_options.template_max_cum_prob:
        #     for option in expand_one_options.retro_backend_options:
        #         option.max_cum_prob = expand_one_options.template_max_cum_prob

        # Modify the overriding logic to apply only if not provided for each option
        for option in expand_one_options.retro_backend_options:
            if not option.max_num_templates and expand_one_options.template_max_count:
                option.max_num_templates = expand_one_options.template_max_count
            if not option.max_cum_prob and expand_one_options.template_max_cum_prob:
                option.max_cum_prob = expand_one_options.template_max_cum_prob

        cluster_setting = expand_one_options.cluster_setting
        if cluster_setting is not None:
            cluster_setting = cluster_setting.dict()

        input = {
            "smiles": smiles,
            "retro_backend_options": [
                option.dict() for option in retro_backend_options
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

        ExpandOneInput(**input)                     # merely validate the input
        last_error = None
        for attempt in range(self.max_retries + 1):
            try:
                http_response = self.session.post(
                    url=url,
                    json=input,
                    timeout=self.request_timeout,
                )
                http_response.raise_for_status()
                response = http_response.json()
                parsed_response = ExpandOneResponse(**response)
                if parsed_response.status_code != 200:
                    raise ExpandOneBackendError(
                        "Expand-one gateway reported failure: "
                        f"{parsed_response.message}"
                    )
                return response["result"]
            except (
                requests.exceptions.RequestException,
                error_wrappers.ValidationError,
                ExpandOneBackendError,
                KeyError,
                TypeError,
                ValueError,
            ) as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    raise ExpandOneBackendError(
                        "Expand-one failed after "
                        f"{self.max_retries + 1} attempts: {exc}"
                    ) from exc

                delay = self.retry_delay * (attempt + 1)
                print(
                    "Transient expand-one failure; "
                    f"retrying in {delay:.2f}s "
                    f"({attempt + 1}/{self.max_retries})."
                )
                time.sleep(delay)

        raise ExpandOneBackendError(
            f"Expand-one failed without a response: {last_error}"
        )
