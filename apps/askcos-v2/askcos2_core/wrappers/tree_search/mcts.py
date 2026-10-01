import re
import traceback
import uuid
from datetime import datetime
from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from schemas.base import LowerCamelAliasModel
from schemas.cluster import ClusterSetting
from schemas.retro import RetroBackendOption
from typing import Annotated, Any, Literal
from utils.oauth2 import oauth2_scheme
from utils.registry import get_util_registry
from utils.tree_search_results import (
    MIN_ROUTE_OUTPUT_COUNT,
    UNCLOSED_TREE_FAILURE_MESSAGE,
    TreeSearchSavedResults,
    TreeSearchResultsController,
    extract_tree_search_total_paths,
)
from wrappers import register_wrapper
from wrappers.base import BaseResponse, BaseWrapper
from wrappers.tree_search.quality_policy import (
    apply_high_quality_route_policy,
    build_minimum_route_count_repair_input,
    build_orchestrated_tree_retro_backend_options,
)


class ExpandOneOptions(LowerCamelAliasModel):
    # aliasing to v1 fields
    template_max_count: int = Field(default=1000, alias="template_count")
    template_max_cum_prob: float = Field(default=0.999, alias="max_cum_template_prob")
    banned_chemicals: list[str] = Field(
        default_factory=list,
        description="banned chemicals (in addition to user banned chemicals)",
        alias="forbidden_molecules",
        example=[]
    )
    banned_reactions: list[str] = Field(
        default_factory=list,
        description="banned reactions (in addition to user banned reactions)",
        alias="known_bad_reactions",
        example=[]
    )

    retro_backend_options: list[RetroBackendOption] = Field(
        default_factory=build_orchestrated_tree_retro_backend_options,
        description="list of retro strategies to run in series"
    )
    use_fast_filter: bool = Field(
        default=True,
        description="whether to filter the results with the fast filter"
    )
    filter_threshold: float = Field(
        default=0.75,
        description="threshold for the fast filter"
    )
    retro_rerank_backend: Literal["relevance_heuristic", "scscore"] | None = Field(
        default=None,
        description="backend for retro rerank"
    )
    atom_map_backend: Literal["indigo", "rxnmapper", "wln"] = Field(
        default="rxnmapper",
        description="backend for atom map"
    )
    cluster_precursors: bool = Field(
        default=True,
        description="whether to cluster proposed precursors"
    )
    cluster_setting: ClusterSetting = Field(
        default_factory=ClusterSetting,
        description="settings for clustering"
    )
    extract_template: bool = Field(
        default=False,
        description="whether to extract templates "
                    "(mostly for template-free suggestions)"
    )
    return_reacting_atoms: bool = Field(
        default=False,
        description="passed through for API compatibility; MCTS always calls expand-one with return_reacting_atoms=false"
    )
    selectivity_check: bool = Field(
        default=False,
        description="whether to perform quick selectivity check "
                    "by reverse application of the forward template"
    )

    model_config = ConfigDict(
        validate_by_name=True,
        validate_by_alias=True
    )


def _hide_optional_fields(schema: dict[str, Any], model: Any) -> None:
    """Helper function to remove specific fields from the generated schema."""
    properties = schema.get("properties", {})

    fields_to_drop = [
        "max_iterations",
        "max_chemicals",
        "max_reactions",
        "max_templates",
        "buyables_source"
    ]

    for field in fields_to_drop:
        # Using .pop(key, None) is safer than del if the key might be missing
        properties.pop(field, None)


class BuildTreeOptions(LowerCamelAliasModel):
    expansion_time: int = Field(
        default=1200,
        description="max time for tree search in seconds",
        example=10
    )
    max_iterations: int | None = Field(
        default=None,
        description="max number of iterations"
    )
    max_chemicals: int | None = Field(
        default=None,
        description="max number of chemicals to explore"
    )
    max_reactions: int | None = Field(
        default=None,
        description="max number of reactions to explore"
    )
    max_templates: int | None = Field(
        default=None,
        description="max number of templates to explore"
    )
    max_branching: int = Field(
        default=50,
        description="max number of branching"
    )
    max_depth: int = Field(
        default=12,
        description="max tree depth"
    )
    exploration_weight: float = Field(
        default=1.0,
        description="weight for exploration (vs. exploitation)"
    )
    return_first: bool = Field(
        default=False,
        description="whether to stop when the first buyable path is found"
    )
    max_trees: int = Field(
        default=200,
        description="max number of buyable paths to explore"
    )

    # a bunch of termination logic. These were passed directly from the front end.
    # Grouping happens at the Django side. Let's tentatively keep that pattern for now.
    buyable_logic: Literal["none", "and", "or"] | None = Field(
        default="and",
        description="logic type for buyable termination"
    )
    max_ppg_logic: Literal["none", "and", "or"] | None = Field(
        default="none",
        description="logic type for price based termination"
    )
    max_ppg: float | None = Field(
        default=None,
        description="maximum price for price based termination"
    )
    max_scscore_logic: Literal["none", "and", "or"] | None = Field(
        default="none",
        description="logic type for synthetic complexity termination"
    )
    max_scscore: float | None = Field(
        default=None,
        description="maximum scscore for synthetic complexity termination"
    )
    chemical_property_logic: Literal["none", "and", "or"] | None = Field(
        default="none",
        description="logic type for chemical property termination"
    )
    max_chemprop_c: int | None = Field(
        default=None,
        description="maximum carbon count for termination"
    )
    max_chemprop_n: int | None = Field(
        default=None,
        description="maximum nitrogen count for termination"
    )
    max_chemprop_o: int | None = Field(
        default=None,
        description="maximum oxygen count for termination"
    )
    max_chemprop_h: int | None = Field(
        default=None,
        description="maximum hydrogen count for termination"
    )
    chemical_popularity_logic: Literal["none", "and", "or"] | None = Field(
        default="none",
        description="logic type for chemical popularity termination"
    )
    min_chempop_reactants: int | None = Field(
        default=5,
        description="minimum reactant precedents for termination"
    )
    min_chempop_products: int | None = Field(
        default=5,
        description="minimum product precedents for termination"
    )

    buyables_source: list[str] | None = Field(
        default=None,
        description="list of source(s) to consider when looking up buyables"
    )
    custom_buyables: list[str] | None = Field(
        default=None,
        description="list of chemicals to consider as buyable",
        example=[]
    )

    model_config = ConfigDict(json_schema_extra=_hide_optional_fields)


class EnumeratePathsOptions(LowerCamelAliasModel):
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


class MCTSInput(LowerCamelAliasModel):
    smiles: str = Field(
        description="target SMILES for MCTS tree building",
        example="CN(C)CCOC(c1ccccc1)c1ccccc1"
    )
    description: str | None = Field(
        default="",
        description="description of the MCTS task",
    )
    tags: str | None = Field(
        default="",
        description="tags of the MCTS task",
    )
    expand_one_options: ExpandOneOptions = Field(
        default_factory=ExpandOneOptions,
        description="options for one-step expansion"
    )
    build_tree_options: BuildTreeOptions = Field(
        default_factory=BuildTreeOptions,
        description="options for MCTS tree search"
    )
    enumerate_paths_options: EnumeratePathsOptions = Field(
        default_factory=EnumeratePathsOptions,
        description="options for path enumeration once the tree is built"
    )
    run_async: bool = False
    result_id: str = str(uuid.uuid4())

    @model_validator(mode="after")
    def enforce_synon_route_quality_policy(self):
        return apply_high_quality_route_policy(self)


class UDS(BaseModel):
    node_dict: dict
    uuid2smiles: dict
    graph: list[dict]
    pathways: list[list[dict]]
    pathways_properties: list[dict]


class MCTSResult(BaseModel):
    stats: dict[str, Any] | None = None
    uds: UDS | None = None
    version: int | str | None = 2
    result_id: str = ""
    route_quality_review: dict[str, Any] | None = None
    route_quality_repair: dict[str, Any] | None = None


class MCTSOutput(BaseModel):
    error: str
    status: str
    results: MCTSResult


class MCTSResponse(BaseResponse):
    result: MCTSResult | None = None


@register_wrapper(
    name="tree_search_mcts",
    input_class=MCTSInput,
    output_class=MCTSOutput,
    response_class=MCTSResponse
)
class MCTSWrapper(BaseWrapper):
    """Wrapper class for Monte Carlo Tree Search"""
    prefixes = ["tree_search/mcts"]
    methods_to_bind: dict[str, list[str]] = {
        "get_config": ["GET"],
        "get_doc": ["GET"],
        "call_sync": ["POST"],
        "call_sync_without_token": ["POST"],
        "call_async": ["POST"],
        "retrieve": ["GET"]
    }

    @staticmethod
    def get_prediction_timeout(
        request: MCTSInput,
        configured_timeout: int | float | None,
    ) -> int | float:
        configured_timeout = configured_timeout or 0
        expansion_time = request.build_tree_options.expansion_time or 0
        if expansion_time <= 0:
            return configured_timeout

        # MCTS still needs time to enumerate and serialize paths after the
        # expansion budget is consumed. Keep the service timeout above the
        # search budget so long searches can finish cleanly.
        budget_buffer = max(300, int(expansion_time * 0.25))
        return max(configured_timeout, expansion_time + budget_buffer)

    def call_raw(self, input: MCTSInput) -> MCTSOutput:
        # Grouping for termination logics used to happen at the Django side.
        # Let's tentatively keep that pattern for now.
        dict_input = self.process_input(input)

        response = self.session_sync.post(
            self.prediction_url,
            json=dict_input,
            timeout=self.get_prediction_timeout(
                request=input,
                configured_timeout=self.config["deployment"]["timeout"],
            )
        )
        output = response.json()
        if output.get("status") == "SUCCESS" and output.get("results") == []:
            output["results"] = {
                "stats": {"total_paths": 0},
                "uds": None,
                "version": 2,
            }
        output = MCTSOutput(**output)

        return output

    @staticmethod
    def build_minimum_route_count_repair_input(input: MCTSInput) -> MCTSInput:
        """Build a bounded second-pass request for searches with too few routes."""

        return build_minimum_route_count_repair_input(input)

    def repair_minimum_route_count_once(
        self,
        input: MCTSInput,
        initial_doc: dict[str, Any],
    ) -> MCTSResult:
        initial_total_paths = extract_tree_search_total_paths(initial_doc)
        repair_input = self.build_minimum_route_count_repair_input(input)
        repair_metadata = {
            "reason": "minimum_route_count_expanded_search",
            "required_route_count": MIN_ROUTE_OUTPUT_COUNT,
            "expanded_search": {
                "expansion_time": repair_input.build_tree_options.expansion_time,
                "max_depth": repair_input.build_tree_options.max_depth,
                "max_branching": repair_input.build_tree_options.max_branching,
                "max_trees": repair_input.build_tree_options.max_trees,
                "filter_threshold": repair_input.expand_one_options.filter_threshold,
            },
        }

        try:
            repair_output = self.call_raw(input=repair_input)
            repair_response = self.convert_output_to_response(repair_output)
        except Exception as exc:
            initial_doc["route_quality_repair"] = {
                **repair_metadata,
                "attempted": True,
                "merged": False,
                "primary_total_paths": initial_total_paths,
                "error": f"{type(exc).__name__}: {exc}",
            }
            return MCTSResult(**initial_doc)

        if repair_response.status_code != 200 or repair_response.result is None:
            initial_doc["route_quality_repair"] = {
                **repair_metadata,
                "attempted": True,
                "merged": False,
                "primary_total_paths": initial_total_paths,
                "error": repair_response.message,
            }
            return MCTSResult(**initial_doc)

        repair_doc = repair_response.result.model_dump()
        repair_total_paths = extract_tree_search_total_paths(repair_doc)
        if repair_total_paths <= initial_total_paths:
            initial_doc["route_quality_repair"] = {
                **repair_metadata,
                "attempted": True,
                "merged": False,
                "primary_total_paths": initial_total_paths,
                "repair_total_paths": repair_total_paths,
                "outcome": "still_below_minimum_route_count",
            }
            return MCTSResult(**initial_doc)

        if initial_total_paths == 0:
            repair_doc["route_quality_repair"] = {
                **repair_metadata,
                "attempted": True,
                "merged": False,
                "selected_repair_result": True,
                "primary_total_paths": initial_total_paths,
                "repair_total_paths": repair_total_paths,
            }
            repair_doc["route_quality_review"] = (
                TreeSearchResultsController.review_tree_builder_route_quality(repair_doc)
            )
            return MCTSResult(**repair_doc)

        merged_doc = TreeSearchResultsController.merge_tree_builder_result_candidates(
            primary_result_doc=initial_doc,
            repair_result_doc=repair_doc,
            repair_metadata=repair_metadata,
        )
        return MCTSResult(**merged_doc)

    def repair_route_diversity_once(
        self,
        input: MCTSInput,
        initial_result: MCTSResult,
    ) -> MCTSResult:
        """Run one diversity repair pass when all returned routes share a root step."""

        initial_doc = initial_result.model_dump()
        review = TreeSearchResultsController.review_tree_builder_route_quality(initial_doc)
        initial_doc["route_quality_review"] = review
        if "minimum_route_count" in (review.get("blockers") or []):
            return self.repair_minimum_route_count_once(
                input=input,
                initial_doc=initial_doc,
            )

        dominant_first_step = review.get("dominant_first_step_reaction")

        if not review.get("needs_repair") or not dominant_first_step:
            return MCTSResult(**initial_doc)

        repair_input = input.model_copy(deep=True)
        if not repair_input.expand_one_options.banned_reactions:
            repair_input.expand_one_options.banned_reactions = []
        if dominant_first_step not in repair_input.expand_one_options.banned_reactions:
            repair_input.expand_one_options.banned_reactions.append(dominant_first_step)

        repair_metadata = {
            "reason": "first_step_family_diversity",
            "banned_first_step_reaction": dominant_first_step,
        }
        try:
            repair_output = self.call_raw(input=repair_input)
            repair_response = self.convert_output_to_response(repair_output)
        except Exception as exc:
            initial_doc["route_quality_repair"] = {
                **repair_metadata,
                "attempted": True,
                "merged": False,
                "error": f"{type(exc).__name__}: {exc}",
            }
            return MCTSResult(**initial_doc)

        if repair_response.status_code != 200 or repair_response.result is None:
            initial_doc["route_quality_repair"] = {
                **repair_metadata,
                "attempted": True,
                "merged": False,
                "error": repair_response.message,
            }
            return MCTSResult(**initial_doc)

        merged_doc = TreeSearchResultsController.merge_tree_builder_result_candidates(
            primary_result_doc=initial_doc,
            repair_result_doc=repair_response.result.model_dump(),
            repair_metadata=repair_metadata,
        )
        return MCTSResult(**merged_doc)

    def call_sync(
        self,
        input: MCTSInput,
        token: Annotated[str, Depends(oauth2_scheme)]
    ) -> MCTSResponse:
        """
        Endpoint for synchronous call to the MCTS tree searcher.
        Login required for access to user banned lists.
        """
        # banned_chemicals handling, requires login token
        if not input.expand_one_options.banned_chemicals:
            input.expand_one_options.banned_chemicals = []
        banned_chemicals_controller = get_util_registry().get_util(
            module="banned_chemicals"
        )
        user_banned_chemicals = banned_chemicals_controller.get(token=token).root
        user_banned_chemicals = [entry.smiles for entry in user_banned_chemicals
                                 if entry.active]
        input.expand_one_options.banned_chemicals.extend(user_banned_chemicals)

        # banned_chemicals handling, requires login token
        if not input.expand_one_options.banned_reactions:
            input.expand_one_options.banned_reactions = []
        banned_reactions_controller = get_util_registry().get_util(
            module="banned_reactions"
        )
        user_banned_reactions = banned_reactions_controller.get(token=token).root
        user_banned_reactions = [entry.smiles for entry in user_banned_reactions
                                 if entry.active]
        input.expand_one_options.banned_reactions.extend(user_banned_reactions)

        results_controller = get_util_registry().get_util(
            module="tree_search_results_controller"
        )

        if input.run_async:
            results_controller.update_result_state(
                result_id=input.result_id,
                state="started",
                token=token
            )
        try:
            # actual backend call
            output = self.call_raw(input=input)
            response = self.convert_output_to_response(output)
            if response.status_code != 200 or response.result is None:
                if input.run_async:
                    results_controller.record_failure(
                        result_id=input.result_id,
                        error=response.message,
                        token=token
                    )
                return response
            result_doc = self.repair_route_diversity_once(
                input=input,
                initial_result=response.result,
            )
            result_doc.result_id = input.result_id
            response.result = result_doc
        except Exception:
            if input.run_async:
                results_controller.record_failure(
                    result_id=input.result_id,
                    error=traceback.format_exc(),
                    token=token
                )
            raise HTTPException(
                status_code=500,
                detail=f"mcts.call_sync() fails with the error: "
                       f"{traceback.format_exc()}"
            )

        if input.run_async:
            try:
                results_controller.save_results(
                    result_id=input.result_id,
                    result=result_doc,
                    token=token
                )
                total_paths = extract_tree_search_total_paths(result_doc.model_dump())
                if total_paths > 0:
                    results_controller.update_result_state(
                        result_id=input.result_id,
                        state="completed",
                        token=token
                    )
                else:
                    results_controller.record_unclosed_result_failure(
                        result_id=input.result_id,
                        result=result_doc,
                        error=UNCLOSED_TREE_FAILURE_MESSAGE,
                        token=token,
                    )
            except Exception:
                results_controller.record_failure(
                    result_id=input.result_id,
                    error=traceback.format_exc(),
                    token=token
                )
                raise HTTPException(
                    status_code=500,
                    detail=f"mcts.call_sync() failed while saving results: "
                           f"{traceback.format_exc()}"
                )

        return response

    def call_sync_without_token(self, input: MCTSInput) -> MCTSResponse:
        """
        Endpoint for synchronous call to the MCTS tree searcher.
        Skip login at the expense of losing access to user banned lists.
        """
        # banned_chemicals handling, does not require login token
        if not input.expand_one_options.banned_chemicals:
            input.expand_one_options.banned_chemicals = []

        # banned_chemicals handling, does not require login token
        if not input.expand_one_options.banned_reactions:
            input.expand_one_options.banned_reactions = []

        # actual backend call
        output = self.call_raw(input=input)
        response = self.convert_output_to_response(output)
        if response.status_code == 200 and response.result is not None:
            response.result = self.repair_route_diversity_once(
                input=input,
                initial_result=response.result,
            )

        print(input.expand_one_options)

        return response

    async def call_async(
        self,
        input: MCTSInput,
        token: Annotated[str, Depends(oauth2_scheme)],
        priority: int = 0
    ) -> str:
        """
        Endpoint for asynchronous call to the MCTS tree searcher.
        Login required for access to user banned lists.
        """
        user_controller = get_util_registry().get_util(module="user_controller")
        user = user_controller.get_current_user(token)

        input.run_async = True
        input.result_id = str(uuid.uuid4())
        # Note that we can't use task_id as the result_id,
        # as it needs to be known beforehand
        settings = input.model_dump()
        settings = {k: v for k, v in settings.items() if "option" in k}

        saved_results = TreeSearchSavedResults(
            user=user.username,
            target_smiles=input.smiles,
            description=input.description,
            created=datetime.now(),
            modified=datetime.now(),
            result_id=input.result_id,
            result_state="pending",
            result_type="tree_builder",
            result=None,
            settings=settings,
            tags=[tag.strip() for tag in re.split(r"[,;]", input.tags)],
            shared_with=[user.username]
        )
        results_controller = get_util_registry().get_util(
            module="tree_search_results_controller"
        )
        results_controller.create(result=saved_results, token=token)

        from askcos2_celery.tasks import tree_search_mcts_task
        async_result = tree_search_mcts_task.apply_async(
            args=(self.name, input.model_dump(), token), priority=priority)
        task_id = async_result.id
        results_controller.set_task_id(
            result_id=input.result_id,
            task_id=task_id,
            token=token,
        )

        return task_id

    async def retrieve(self, task_id: str) -> MCTSResponse | None:
        return await super().retrieve(task_id=task_id)

    @staticmethod
    def process_input(input: MCTSInput) -> dict:
        build_tree_options = input.build_tree_options
        dict_input = input.model_dump()

        termination_logic = {"and": [], "or": []}

        buyable_logic = build_tree_options.buyable_logic
        if buyable_logic != "none":
            termination_logic[buyable_logic].append("buyable")

        max_ppg_logic = build_tree_options.max_ppg_logic
        if max_ppg_logic != "none":
            max_ppg = build_tree_options.max_ppg
            termination_logic[max_ppg_logic].append("max_ppg")
        else:
            max_ppg = None

        max_scscore_logic = build_tree_options.max_scscore_logic
        if max_scscore_logic != "none":
            max_scscore = build_tree_options.max_scscore
            termination_logic[max_scscore_logic].append("max_scscore")
        else:
            max_scscore = None

        chemical_property_logic = build_tree_options.chemical_property_logic
        if chemical_property_logic != "none":
            param_dict = {
                "C": "max_chemprop_c",
                "N": "max_chemprop_n",
                "O": "max_chemprop_o",
                "H": "max_chemprop_h",
            }
            max_elements = {
                k: getattr(build_tree_options, v) for k, v in param_dict.items()
                if hasattr(build_tree_options, v)
            }
            termination_logic[chemical_property_logic].append("max_elements")
        else:
            max_elements = None

        chemical_popularity_logic = build_tree_options.chemical_popularity_logic
        if chemical_popularity_logic != "none":
            min_history = {
                "as_reactant": build_tree_options.min_chempop_reactants,
                "as_product": build_tree_options.min_chempop_products
            }
            termination_logic[chemical_popularity_logic].append("min_history")
        else:
            min_history = None

        dict_input["build_tree_options"].update({
            "max_ppg": max_ppg,
            "max_scscore": max_scscore,
            "max_elements": max_elements,
            "min_history": min_history,
            "termination_logic": termination_logic,
        })

        return dict_input

    @staticmethod
    def convert_output_to_response(output: MCTSOutput
                                   ) -> MCTSResponse:
        status_code = 200
        message = "mcts.call_raw() successfully executed."
        result = output.results

        if not output.status == "SUCCESS":
            status_code = 500
            message = f"Backend error encountered during mcts.call_raw() " \
                      f"with the following error message {output.error}"
            result = None

        response = MCTSResponse(
            status_code=status_code,
            message=message,
            result=result
        )

        return response
