import os
import time
from dataclasses import dataclass
from threading import Event

from packages.platform.native_endpoints import resolve_native_endpoints
from packages.platform.native_search_contract import SEARCH_KEY_VARIABLE, NATIVE_SEARCH_HEADER, NATIVE_SEARCH_PREFIX

from .transport import AskcosTransport, EngineUnavailable


@dataclass(frozen=True)
class AskcosSearchResult:
    strategy: str
    payload: dict


def build_search_options(
    request, *, strategy: str, models: list[str], pass_number: int = 1, rejected_reactions=None
):
    if strategy not in {"mcts", "retro_star"} or not models:
        raise ValueError("A configured native search strategy and model are required")
    expansion = request.expansion_time
    tuning = request.tuning
    cumulative = (
        1.0 if pass_number > 1 and request.search_policy_version >= 2
        else tuning.cumulative_probability
    )
    options = {
        "smiles": request.smiles,
        "expand_one_options": {
            "retro_backend_options": [
                {
                    "retro_backend": "template_relevance",
                    "retro_model_name": name,
                    "max_num_templates": min(5000, tuning.template_count * pass_number),
                    "max_cum_prob": cumulative,
                }
                for name in models
            ],
            "use_fast_filter": True,
            "filter_threshold": tuning.minimum_plausibility,
            "return_reacting_atoms": False,
            "extract_template": False,
        },
        "build_tree_options": {
            "expansion_time": expansion,
            "max_trees": request.max_paths,
            "max_depth": min(50, tuning.max_depth + 4 * (pass_number - 1)),
            "max_branching": tuning.max_branching,
            "return_first": False,
            "termination_logic": {"and": ["buyable"]},
            "buyables_source": "unified_commercial",
        },
        "enumerate_paths_options": {
            "json_format": "nodelink",
            "max_paths": request.max_paths,
            "sorting_metric": "score",
            "score_trees": True,
            "cluster_trees": True,
            "validate_paths": True,
        },
    }
    if strategy == "retro_star":
        options["build_tree_options"]["use_value_network"] = True
    if rejected_reactions:
        options["expand_one_options"]["banned_reactions"] = sorted(set(rejected_reactions))
    return options


class AskcosEngine:
    engine_id = "askcos_v2"

    def __init__(self, transport: AskcosTransport):
        self.transport = transport

    def search(
        self,
        request,
        *,
        strategy: str,
        models: list[str],
        child_id: str,
        pass_number: int = 1,
        cancelled=lambda: False,
        interrupted: Event | None = None,
        progress=lambda value: None,
        rejected_reactions=None,
    ):
        options = build_search_options(
            request, strategy=strategy, models=models, pass_number=pass_number,
            rejected_reactions=rejected_reactions,
        )
        expansion = request.expansion_time
        try:
            url = resolve_native_endpoints(managed=True)[strategy].url
        except ValueError:
            raise EngineUnavailable(
                "native_search_endpoint_invalid", recoverable=False
            ) from None
        key = os.environ.get(SEARCH_KEY_VARIABLE)
        if not key:
            raise EngineUnavailable("native_search_key_missing", recoverable=False)
        native = AskcosTransport(url, budget=self.transport.budget)
        native.opener.addheaders.append((NATIVE_SEARCH_HEADER, key))
        record = native.call(
            NATIVE_SEARCH_PREFIX, body={"id": child_id, "input": options}, timeout=30
        )
        child_path = NATIVE_SEARCH_PREFIX + "/" + child_id
        deadline = time.monotonic() + expansion + 900
        last_progress = None
        while True:
            if cancelled():
                native.call(child_path, method="DELETE", timeout=5)
                raise EngineUnavailable("search_cancelled", recoverable=False)
            if interrupted is not None and interrupted.is_set():
                # The native child remains alive; a resumed product worker attaches to its ID.
                raise EngineUnavailable("product_worker_stopped")
            if not isinstance(record, dict) or record.get("id") != child_id:
                raise EngineUnavailable(
                    "invalid_native_search_record", recoverable=False
                )
            observed = record.get("progress")
            if isinstance(observed, dict) and isinstance(record.get("dependency_failure"), dict):
                observed = {**observed, "dependency_failure": record["dependency_failure"]}
            if isinstance(observed, dict) and observed != last_progress:
                progress(observed)
                last_progress = observed
            if record.get("status") == "completed":
                payload = native.call(
                    child_path + "/result", timeout=60
                )
                if not isinstance(payload, dict) or not isinstance(
                    payload.get("uds"), dict
                ):
                    raise EngineUnavailable(
                        "invalid_native_search_result", recoverable=False
                    )
                return AskcosSearchResult(
                    strategy, {"result": payload, "target_smiles": request.smiles}
                )
            if record.get("status") in {"failed", "cancelled", "interrupted"}:
                raise EngineUnavailable(
                    record.get("error_code", "native_search_" + record["status"]),
                    recoverable=record["status"] == "interrupted",
                )
            if time.monotonic() >= deadline:
                raise EngineUnavailable("native_search_deadline")
            if interrupted is not None:
                interrupted.wait(1)
            else:
                time.sleep(1)
            record = native.call(child_path, timeout=10)
