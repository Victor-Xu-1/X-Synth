import copy
from collections import Counter
import json
import os
import urllib.error
import urllib.request
import uuid
from askcos2_celery.celery import app as celery_app
from celery import states
from configs import db_config
from datetime import datetime
from fastapi import Body, Depends, HTTPException, Response
from pydantic import BaseModel, constr, Field
from pymongo import errors, MongoClient
from rdkit import Chem
from typing import Annotated, Any, Literal
from utils import register_util
from utils.oauth2 import oauth2_scheme
from utils.registry import get_util_registry
from utils.tree_search_results_util import standardize_result_ipp, standardize_result_tb

# TODO: fix the time zone issue

INCOMPLETE_RESULT_STATES = {"pending", "started"}
STALE_STARTED_GRACE_SECONDS = int(os.environ.get("ASKCOS_STALE_STARTED_GRACE_SECONDS", "21600"))
STALE_PENDING_GRACE_SECONDS = int(os.environ.get("ASKCOS_STALE_PENDING_GRACE_SECONDS", "900"))
STALE_STARTED_PENDING_GRACE_SECONDS = int(
    os.environ.get("ASKCOS_STALE_STARTED_PENDING_GRACE_SECONDS", "300")
)
MIN_ROUTE_OUTPUT_COUNT = int(os.environ.get("ASKCOS_MIN_ROUTE_OUTPUT_COUNT", "3"))
UNCLOSED_TREE_FAILURE_MESSAGE = (
    "Tree search completed but found no buyable closed route after the expanded "
    "search strategy. The explored search diagnostics were preserved."
)


class TreeSearchSavedResults(BaseModel):
    """
    Reimplemented SavedResults model
    """
    user: str | None = None
    description: constr(max_length=1000) | None = None
    created: datetime = Field(default_factory=datetime.now)
    modified: datetime = Field(default_factory=datetime.now)
    dt: constr(max_length=200) | None = None
    result_id: constr(max_length=64) | None = None
    task_id: constr(max_length=64) | None = None
    result: dict | None = None
    settings: dict | None = None
    tags: list[str] | str | None = Field(default_factory=list)
    check_date: str | None = None
    result_state: constr(max_length=64) | None = None
    result_type: str = "tree_builder"
    revision: int = 0

    target_smiles: str | None = None
    num_trees: int | None = 0
    unified_route_pool_summary: dict | None = None

    public: bool = False
    shared_with: list[str] = Field(default_factory=list)

class UDS(BaseModel):
    node_dict: dict
    uuid2smiles: dict
    graph: dict
    pathways: list[dict]

class Metadata(BaseModel):
    uds: UDS


SIMULATION_DISCLAIMER = (
    "SIMULATED TEST DATA - NOT FOR PUBLICATION. Use only for ASKCOS product "
    "testing and workflow validation."
)


ARTICLE_SECTION_BLUEPRINTS = [
    ("title", "Publication-style title", "Generate a concise JMC/JOC-style title grounded in the target and selected route."),
    ("abstract", "Abstract", "Write a structured abstract covering route selection, step count, key transformations, and test-only status."),
    ("route_rationale", "Route selection rationale", "Explain why this ASKCOS route was selected, using route metrics and reaction sequence only."),
    ("synthetic_scheme", "Synthetic scheme narrative", "Convert the selected route graph into a stepwise synthetic scheme description."),
    ("experimental_procedures", "Experimental procedures", "Draft detailed procedure text for planning review; do not invent measured yields or analytical results."),
    ("characterization", "Characterization and NMR reporting plan", "Prepare JMC-style characterization placeholders and identify required entered or measured spectra."),
    ("comparison_and_controls", "Experimental comparison and controls", "List control experiments, route alternatives, reaction monitoring checks, and reproducibility criteria."),
    ("conclusion", "Conclusion", "Draft a conclusion grounded in route intent and explicit test-mode limitations."),
    ("limitations", "Limitations and non-publication notice", "State generated content is for ASKCOS testing only and must be replaced with real experimental data."),
]

REQUIRED_EXPERIMENTAL_DATA_FIELDS = [
    "reaction_conditions",
    "isolated_yield",
    "hrms_or_lcms",
    "nmr_records",
]


def _as_dict(value):
    return value if isinstance(value, dict) else {}


def _as_list(value):
    return value if isinstance(value, list) else []


def extract_tree_search_total_paths(result_doc):
    if not isinstance(result_doc, dict):
        return 0

    stats = result_doc.get("stats")
    if isinstance(stats, dict) and stats.get("total_paths") is not None:
        try:
            return max(0, int(stats.get("total_paths")))
        except (TypeError, ValueError):
            return 0

    uds = result_doc.get("uds")
    pathways = uds.get("pathways") if isinstance(uds, dict) else None
    if isinstance(pathways, list):
        return len(pathways)

    return 0


def build_tree_search_failure_update(error, modified=None):
    modified = modified or datetime.now()
    message = str(error or "Tree search failed without an error message.")
    return {
        "$set": {
            "result_state": "failed",
            "result": {
                "status": "FAILED",
                "error": message,
                "stats": {"total_paths": 0},
                "uds": None,
            },
            "num_trees": 0,
            "modified": modified,
        }
    }


def _extract_route_steps(route):
    steps = []
    for node in _as_list(route.get("nodes")):
        node = _as_dict(node)
        smiles = str(node.get("smiles") or "").strip()
        if node.get("type") != "reaction" and ">>" not in smiles:
            continue
        precursors, _, product = smiles.partition(">>")
        steps.append({
            "step": len(steps) + 1,
            "node_id": node.get("id") or smiles,
            "reaction_smiles": smiles,
            "precursors": [item for item in precursors.split(".") if item],
            "product": product,
            "llm_instruction": (
                "Generate a publication-style experimental draft from this selected "
                "route step only. Do not claim measured yield, purity, spectra, or "
                "successful execution unless the user supplies those values."
            ),
        })
    return steps


def _build_experimental_data_template(route_steps):
    return {
        "reaction_conditions": "",
        "isolated_yield": "",
        "hrms_or_lcms": "",
        "nmr_records": [],
        "controls": "",
        "route_comparison_notes": "",
        "limitations": "",
        "step_records": [
            {
                "step": step["step"],
                "reaction_smiles": step["reaction_smiles"],
                "reaction_conditions": "",
                "stoichiometry": "",
                "workup": "",
                "purification": "",
                "isolated_yield": "",
                "characterization_notes": "",
            }
            for step in route_steps
        ],
    }


def validate_route_publication_experimental_data(experimental_data):
    experimental_data = _as_dict(experimental_data)
    missing = []
    for field in REQUIRED_EXPERIMENTAL_DATA_FIELDS:
        value = experimental_data.get(field)
        if isinstance(value, str):
            has_value = bool(value.strip())
        elif isinstance(value, list):
            has_value = bool(value)
        else:
            has_value = value is not None
        if not has_value:
            missing.append(field)
    return missing


def _normalize_comparison_routes(routes):
    normalized = []
    for route in _as_list(routes):
        route = _as_dict(route)
        normalized.append({
            "route_index": route.get("route_index", len(normalized)),
            "metrics": _as_dict(route.get("metrics") or route.get("graph")),
            "notes": str(route.get("notes") or ""),
        })
    return normalized


def build_route_publication_contract(data_mode="simulation"):
    return {
        "requires_llm": True,
        "data_mode": data_mode,
        "required_inputs": ["target_smiles", "selected_route", "route_steps", "user_supplied_experimental_data"],
        "allowed_outputs": ["publication_style_title", "route_grounded_abstract", "procedure_drafts", "simulated_day_plan"],
        "forbidden_claims": ["measured_yield", "isolated_yield", "confirmed_structure", "successful_synthesis", "publication_ready"],
        "forbidden_operations": ["invent_nmr_peaks", "invent_yields", "invent_hrms_values", "invent_melting_points"],
    }


def build_route_publication_package(payload):
    payload = _as_dict(payload)
    selected_route = _as_dict(payload.get("selected_route"))
    route_steps = _extract_route_steps(selected_route)
    target_smiles = str(payload.get("target_smiles") or "").strip()
    contract = build_route_publication_contract(payload.get("data_mode") or "simulation")
    experimental_data_template = _build_experimental_data_template(route_steps)
    sections = [
        {
            "key": key,
            "title": title,
            "requires_llm": True,
            "prompt": prompt,
            "route_step_refs": [step["step"] for step in route_steps],
            "status": "ready_for_llm",
        }
        for key, title, prompt in ARTICLE_SECTION_BLUEPRINTS
    ]
    daily_plan = [{
        "day": 1,
        "objective": "Route review, material sourcing check, risk assessment, and reaction notebook setup.",
        "deliverable": "Approved test protocol and missing-data checklist.",
    }]
    for step in route_steps:
        daily_plan.append({
            "day": step["step"] + 1,
            "objective": f"Run or dry-run route step {step['step']} under test-workflow conditions.",
            "deliverable": f"Route step {step['step']} procedure draft and required measured-data fields.",
        })
    daily_plan.append({
        "day": max(1, len(route_steps)) + 2,
        "objective": "Compile characterization, controls, comparison table, and conclusion.",
        "deliverable": "Draft JMC/JOC-style test package with non-publication disclaimer.",
    })
    context = {"target_smiles": target_smiles, "route_steps": route_steps, "contract": contract, "disclaimer": SIMULATION_DISCLAIMER}
    return {
        "data_mode": payload.get("data_mode") or "simulation",
        "generation_style": payload.get("generation_style") or "publication",
        "publishable": False,
        "not_for_publication": True,
        "disclaimer": SIMULATION_DISCLAIMER,
        "selected_route": {
            "result_id": payload.get("result_id") or "",
            "route_index": payload.get("route_index", 0),
            "target_smiles": target_smiles,
            "metrics": _as_dict(selected_route.get("graph")),
            "nodes": _as_list(selected_route.get("nodes")),
            "edges": _as_list(selected_route.get("edges")),
        },
        "comparison_routes": _normalize_comparison_routes(payload.get("comparison_routes")),
        "route_steps": route_steps,
        "article_sections": sections,
        "daily_plan": daily_plan,
        "experimental_data_template": experimental_data_template,
        "missing_required_fields": validate_route_publication_experimental_data(experimental_data_template),
        "export_contract": {
            "formats": ["markdown", "json"],
            "requires_entered_experimental_data": True,
            "publishable": False,
        },
        "llm_contract": contract,
        "llm_tasks": [
            {
                "key": section["key"],
                "title": section["title"],
                "prompt": (
                    f"You are drafting '{section['title']}' for a JMC/JOC-style ASKCOS route package. "
                    "Use only the JSON context. Keep the non-publication disclaimer. Do not invent measured data.\n"
                    f"{json.dumps(context, ensure_ascii=False, indent=2)}"
                ),
                "requires_llm": True,
                "status": "pending_provider",
            }
            for section in sections
        ],
        "required_user_data": ["actual conditions", "isolated mass and measured yield", "entered NMR assignments", "entered HRMS or LCMS evidence"],
        "warnings": [SIMULATION_DISCLAIMER],
    }


def format_route_publication_nmr(record):
    record = _as_dict(record)
    peaks = []
    for peak in _as_list(record.get("peaks")):
        peak = _as_dict(peak)
        annotations = [str(peak[k]) for k in ["multiplicity", "integration"] if peak.get(k)]
        if peak.get("j_hz"):
            annotations.insert(1, f"J = {peak['j_hz']} Hz")
        peaks.append(f"{peak.get('shift')} ({', '.join(annotations)})" if annotations else str(peak.get("shift")))
    header = f"{record.get('nucleus') or '1H'} NMR ({record.get('frequency_mhz')} MHz, {record.get('solvent') or 'CDCl3'})"
    text = f"{header}: δ {', '.join(peaks) or 'data required'}."
    if str(record.get("source_type") or "missing").lower() != "entered":
        text = f"[{SIMULATION_DISCLAIMER}] {text}"
    return text


def format_route_publication_nmr_batch(records):
    return [format_route_publication_nmr(record) for record in _as_list(records)]


def _section_draft_map(section_drafts):
    return {
        str(_as_dict(draft).get("key") or ""): _as_dict(draft)
        for draft in _as_list(section_drafts)
        if _as_dict(draft).get("key")
    }


def _markdown_table(headers, rows):
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(str(cell).replace("\n", " ") for cell in row) + " |")
    return "\n".join(lines)


def assemble_route_publication_document(payload):
    payload = _as_dict(payload)
    package = _as_dict(payload.get("package"))
    if not package:
        package = build_route_publication_package(payload)

    experimental_data = _as_dict(payload.get("experimental_data"))
    drafts = _section_draft_map(payload.get("section_drafts"))
    missing_fields = validate_route_publication_experimental_data(experimental_data)
    nmr_texts = format_route_publication_nmr_batch(experimental_data.get("nmr_records"))

    selected_route = _as_dict(package.get("selected_route"))
    route_steps = _as_list(package.get("route_steps"))
    comparison_routes = _as_list(package.get("comparison_routes"))
    daily_plan = _as_list(package.get("daily_plan"))
    article_sections = _as_list(package.get("article_sections"))

    title = drafts.get("title", {}).get("content") or "ASKCOS route-linked test dossier"
    abstract = drafts.get("abstract", {}).get("content") or "Abstract draft pending LLM generation or user entry."
    markdown = [
        f"# {title}",
        "",
        f"> {package.get('disclaimer') or SIMULATION_DISCLAIMER}",
        "",
        "## Abstract",
        "",
        abstract,
        "",
        "## Selected ASKCOS Route",
        "",
        f"- Target SMILES: `{selected_route.get('target_smiles') or ''}`",
        f"- Route index: {selected_route.get('route_index', 0)}",
        f"- Reaction steps: {len(route_steps)}",
        "",
    ]
    if route_steps:
        markdown.extend([
            _markdown_table(
                ["Step", "Reaction SMILES", "Precursors", "Product"],
                [
                    [
                        step.get("step"),
                        f"`{step.get('reaction_smiles') or ''}`",
                        " + ".join(_as_list(step.get("precursors"))),
                        f"`{step.get('product') or ''}`",
                    ]
                    for step in route_steps
                ],
            ),
            "",
        ])

    markdown.extend(["## Comparison Routes", ""])
    if comparison_routes:
        markdown.extend([
            _markdown_table(
                ["Route", "Metrics", "Notes"],
                [
                    [
                        route.get("route_index"),
                        json.dumps(_as_dict(route.get("metrics")), ensure_ascii=False, sort_keys=True),
                        route.get("notes") or "",
                    ]
                    for route in comparison_routes
                ],
            ),
            "",
        ])
    else:
        markdown.extend(["No comparison routes were selected.", ""])

    markdown.extend([
        "## Entered Experimental Data",
        "",
        f"- Reaction conditions: {experimental_data.get('reaction_conditions') or 'data required'}",
        f"- Isolated yield: {experimental_data.get('isolated_yield') or 'data required'}",
        f"- HRMS/LCMS: {experimental_data.get('hrms_or_lcms') or 'data required'}",
        f"- Controls: {experimental_data.get('controls') or 'data required'}",
        "",
        "### NMR",
        "",
    ])
    markdown.extend(nmr_texts or ["data required"])
    markdown.extend(["", "## Daily Experimental Plan", ""])
    if daily_plan:
        markdown.extend([
            _markdown_table(
                ["Day", "Objective", "Deliverable"],
                [
                    [day.get("day"), day.get("objective") or "", day.get("deliverable") or ""]
                    for day in daily_plan
                ],
            ),
            "",
        ])

    markdown.extend(["## Manuscript Sections", ""])
    for section in article_sections:
        section = _as_dict(section)
        key = section.get("key")
        if key in {"title", "abstract"}:
            continue
        draft = drafts.get(key, {})
        markdown.extend([
            f"### {section.get('title') or key}",
            "",
            draft.get("content") or "Draft pending LLM generation or user entry.",
            "",
        ])

    markdown.extend([
        "## Required Data Check",
        "",
        "Complete." if not missing_fields else "Missing: " + ", ".join(missing_fields),
        "",
    ])

    document_json = {
        "package": package,
        "experimental_data": experimental_data,
        "section_drafts": _as_list(payload.get("section_drafts")),
        "missing_required_fields": missing_fields,
        "nmr_texts": nmr_texts,
    }
    return {
        "publishable": False,
        "not_for_publication": True,
        "disclaimer": package.get("disclaimer") or SIMULATION_DISCLAIMER,
        "missing_required_fields": missing_fields,
        "nmr_texts": nmr_texts,
        "markdown": "\n".join(markdown),
        "json": document_json,
    }


def get_route_publication_llm_status():
    provider = os.environ.get("LLM_PROVIDER") or os.environ.get("SYNTHESIS_PROVIDER")
    base_url = os.environ.get("LLM_BASE_URL") or os.environ.get("SYNTHESIS_GPT_BASE_URL")
    model = os.environ.get("LLM_MODEL") or os.environ.get("SYNTHESIS_GPT_MODEL")
    has_key = bool(os.environ.get("LLM_API_KEY") or os.environ.get("SYNTHESIS_GPT_API_KEY"))
    return {"configured": bool(provider and base_url and model and has_key), "provider": provider or "", "base_url": base_url or "", "model": model or ""}


def run_route_publication_llm_task(task):
    status = get_route_publication_llm_status()
    if not status["configured"]:
        return {"status": "not_configured", "message": "LLM provider is not configured. Returning the task prompt for review.", "task": task}
    api_key = os.environ.get("LLM_API_KEY") or os.environ.get("SYNTHESIS_GPT_API_KEY")
    request = urllib.request.Request(
        status["base_url"].rstrip("/") + "/chat/completions",
        data=json.dumps({
            "model": status["model"],
            "messages": [
                {"role": "system", "content": "Generate chemistry manuscript drafts from ASKCOS route data. Never invent measured data."},
                {"role": "user", "content": str(task.get("prompt") or "")},
            ],
            "temperature": 0.2,
        }).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return {"status": "provider_error", "message": exc.read().decode("utf-8", errors="replace"), "http_status": exc.code}
    except Exception as exc:
        return {"status": "provider_error", "message": str(exc)}
    return {"status": "complete", "content": data.get("choices", [{}])[0].get("message", {}).get("content", ""), "raw": data}


@register_util(name="route_publication")
class RoutePublication:
    prefixes = ["route_publications"]
    methods_to_bind = {
        "create_from_route": ["POST"],
        "assemble_document": ["POST"],
        "format_nmr": ["POST"],
        "format_nmr_batch": ["POST"],
        "validate_experimental_data": ["POST"],
        "llm_task_contract": ["GET"],
        "llm_status": ["GET"],
        "run_llm_task": ["POST"],
    }

    def __init__(self, util_config=None):
        self.util_config = util_config or {}

    def create_from_route(self, payload: dict[str, Any] = Body(...)):
        return build_route_publication_package(payload)

    def assemble_document(self, payload: dict[str, Any] = Body(...)):
        return assemble_route_publication_document(payload)

    def format_nmr(self, payload: dict[str, Any] = Body(...)):
        return {"text": format_route_publication_nmr(payload)}

    def format_nmr_batch(self, payload: dict[str, Any] = Body(...)):
        return {"texts": format_route_publication_nmr_batch(_as_list(payload.get("records")))}

    def validate_experimental_data(self, payload: dict[str, Any] = Body(...)):
        return {"missing_required_fields": validate_route_publication_experimental_data(payload)}

    def llm_task_contract(self, data_mode="simulation"):
        return build_route_publication_contract(data_mode=data_mode)

    def llm_status(self):
        return get_route_publication_llm_status()

    def run_llm_task(self, payload: dict[str, Any] = Body(...)):
        return run_route_publication_llm_task(payload)

@register_util(name="tree_search_results_controller")
class TreeSearchResultsController:
    """
    Util class for tree search results controller
    """
    prefixes = ["results"]
    methods_to_bind: dict[str, list[str]] = {
        "list": ["GET"],
        "retrieve": ["GET"],
        "retrieve_pathway_metadata": ["POST"],
        "create": ["POST"],
        "update": ["PUT"],
        "destroy": ["DELETE"],
        "share": ["GET"],
        "unshare": ["GET"],
        "add": ["POST"],
        "remove": ["DELETE"]
    }

    def __init__(self, util_config: dict[str, Any]):
        """
        Initialize database connection.
        """
        self.client = MongoClient(serverSelectionTimeoutMS=1000, **db_config.MONGO)
        database = util_config["database"]
        collection = util_config["collection"]

        try:
            self.client.server_info()
        except errors.ServerSelectionTimeoutError:
            raise ValueError("Cannot connect to mongodb to load results")
        else:
            self.collection = self.client[database][collection]
            self.db = self.client[database]

    @staticmethod
    def _collect_live_celery_task_ids(*task_groups: dict | None) -> set[str]:
        live_task_ids = set()
        for task_group in task_groups:
            if not isinstance(task_group, dict):
                continue
            for tasks in task_group.values():
                if not isinstance(tasks, list):
                    continue
                for task in tasks:
                    if not isinstance(task, dict):
                        continue
                    task_id = task.get("id")
                    request = task.get("request")
                    if not task_id and isinstance(request, dict):
                        task_id = request.get("id")
                    if task_id:
                        live_task_ids.add(task_id)
        return live_task_ids

    @staticmethod
    def _get_live_celery_task_ids() -> set[str] | None:
        try:
            inspector = celery_app.control.inspect(timeout=1.0)
            return TreeSearchResultsController._collect_live_celery_task_ids(
                inspector.active(),
                inspector.reserved(),
                inspector.scheduled(),
            )
        except Exception:
            return None

    @staticmethod
    def _incomplete_result_grace_seconds(result_state: str | None, task_state: str | None) -> int:
        if result_state == "started" and task_state == states.PENDING:
            return STALE_STARTED_PENDING_GRACE_SECONDS
        if result_state == "pending":
            return STALE_PENDING_GRACE_SECONDS
        return STALE_STARTED_GRACE_SECONDS

    def reconcile_incomplete_results_for_user(self, username: str) -> None:
        """
        Close result lifecycle gaps caused by worker/container restarts.

        Celery can leave task metadata in STARTED after the worker process has
        disappeared. The UI should not show those jobs as running forever.
        """
        candidates = list(
            self.collection.find(
                {
                    "user": username,
                    "result_type": "tree_builder",
                    "result_state": {"$in": list(INCOMPLETE_RESULT_STATES)},
                },
                {"result_id": 1, "task_id": 1, "modified": 1, "result_state": 1},
            )
        )
        if not candidates:
            return

        live_task_ids = self._get_live_celery_task_ids()
        if live_task_ids is None:
            return

        now = datetime.now()
        for result in candidates:
            task_id = result.get("task_id")
            result_id = result.get("result_id")
            if not result_id:
                continue

            modified = result.get("modified") or now
            age_seconds = (now - modified).total_seconds()

            if not task_id:
                if age_seconds < self._incomplete_result_grace_seconds(
                    result.get("result_state"),
                    states.PENDING,
                ):
                    continue
                self.collection.update_one(
                    {"user": username, "result_id": result_id},
                    build_tree_search_failure_update(
                        "Tree search result was left incomplete and is missing Celery task id; "
                        "the task cannot be resumed or verified."
                    ),
                )
                continue

            task = celery_app.AsyncResult(task_id)
            if task.state == states.FAILURE:
                self.collection.update_one(
                    {"user": username, "result_id": result_id},
                    build_tree_search_failure_update(task.result),
                )
                continue

            if task_id in live_task_ids:
                continue

            if age_seconds < self._incomplete_result_grace_seconds(
                result.get("result_state"),
                task.state,
            ):
                continue

            if task.state not in {states.PENDING, states.STARTED}:
                continue

            self.collection.update_one(
                {"user": username, "result_id": result_id},
                build_tree_search_failure_update(
                    "Celery task is no longer active or known to the result backend; "
                    "the worker was likely restarted before result persistence."
                ),
            )

    @staticmethod
    def _compact_uds_node(node: dict) -> dict:
        """
        Keep route-display fields and drop bulky backend-only payload.

        Tree search nodes may include full template examples, mapped reaction
        payloads, and model internals. The result UI needs stable identifiers,
        node type, drawing SMILES, and route/reaction scores.
        """
        if not isinstance(node, dict):
            return {}

        keep_fields = {
            "id",
            "smiles",
            "type",
            "terminal",
            "solved",
            "ppg",
            "purchase_price",
            "molwt",
            "scscore",
            "as_reactant",
            "as_product",
            "plausibility",
            "rxn_score_from_model",
            "precursor_score",
            "precursor_rank",
            "template_set",
            "template_score",
            "template_rank",
            "template_id",
            "template_hash",
            "tforms",
            "tsources",
            "retro_backend",
            "retro_model_name",
            "model_name",
            "class_num",
            "class_name",
            "reaction_id",
            "reaction_set",
        }
        compacted = {
            key: value
            for key, value in node.items()
            if key in keep_fields and value is not None
        }

        for nested_key in ("model_metadata", "reaction_properties", "precursor_properties"):
            nested = node.get(nested_key)
            if not isinstance(nested, dict):
                continue
            if nested_key == "precursor_properties":
                compacted[nested_key] = {
                    key: value
                    for key, value in nested.items()
                    if key in {
                        "num_rings",
                        "rms_molwt",
                        "scscore",
                        "precursor_prices",
                    }
                    and value is not None
                }
                continue
            compacted[nested_key] = {
                key: value
                for key, value in nested.items()
                if key in {
                    "backend",
                    "model",
                    "model_name",
                    "template_id",
                    "template_hash",
                    "template_set",
                    "score",
                    "rank",
                    "reaction_id",
                    "reaction_set",
                    "cluster_id",
                    "cluster_name",
                }
                and value is not None
            }

        if "type" not in compacted and "smiles" in compacted:
            compacted["type"] = (
                "reaction" if ">>" in str(compacted["smiles"]) else "chemical"
            )
        return compacted

    @staticmethod
    def _compact_uds_edge(edge: dict) -> dict:
        return {
            "source": edge.get("source"),
            "target": edge.get("target"),
        }

    @staticmethod
    def _compact_pathway_properties(properties: dict) -> dict:
        if not isinstance(properties, dict):
            return {}

        keep_fields = {
            "depth",
            "precursor_cost",
            "score",
            "cluster_id",
            "first_step_score",
            "first_step_plausibility",
            "num_reactions",
            "avg_score",
            "avg_plausibility",
            "min_score",
            "min_plausibility",
            "atom_economy",
        }
        return {
            key: value
            for key, value in properties.items()
            if key in keep_fields and value is not None
        }

    @staticmethod
    def _pathway_reaction_signature(pathway_edges: list, uuid2smiles: dict) -> tuple[str, ...]:
        reactions = []
        seen = set()
        for edge in pathway_edges or []:
            for endpoint in (edge.get("source"), edge.get("target")):
                smiles = uuid2smiles.get(endpoint)
                if not isinstance(smiles, str) or ">>" not in smiles:
                    continue
                if smiles in seen:
                    continue
                seen.add(smiles)
                reactions.append(smiles)
        return tuple(reactions)

    @classmethod
    def _pathway_diversity_keys(
        cls,
        pathway_edges: list,
        properties: dict,
        uuid2smiles: dict,
    ) -> list[tuple]:
        reaction_signature = cls._pathway_reaction_signature(pathway_edges, uuid2smiles)
        first_reaction = reaction_signature[0] if reaction_signature else ""
        first_two_reactions = reaction_signature[:2]
        cluster_id = properties.get("cluster_id") if isinstance(properties, dict) else None
        keys = []
        if cluster_id is not None:
            keys.append(("cluster", cluster_id))
        if first_reaction:
            keys.append(("first_step", first_reaction))
        if first_two_reactions:
            keys.append(("first_two_steps", first_two_reactions))
        keys.append(("full_signature", reaction_signature))
        return keys

    @classmethod
    def _pathway_family_key(
        cls,
        pathway_edges: list,
        properties: dict,
        uuid2smiles: dict,
    ) -> tuple:
        diversity_keys = cls._pathway_diversity_keys(
            pathway_edges=pathway_edges,
            properties=properties,
            uuid2smiles=uuid2smiles,
        )
        if diversity_keys:
            return diversity_keys[0]
        return ("pathway_indexless",)

    @classmethod
    def _pathway_first_step_reaction(
        cls,
        pathway_edges: list,
        uuid2smiles: dict,
    ) -> str | None:
        reaction_signature = cls._pathway_reaction_signature(pathway_edges, uuid2smiles)
        return reaction_signature[0] if reaction_signature else None

    @classmethod
    def review_tree_builder_route_quality(cls, result_doc: dict) -> dict:
        """Review whether stored route output satisfies the Synon route contract.

        A result can have enough buyable pathways but still be low-value when all
        pathways share the same first disconnection. This review is intentionally
        deterministic and stored with the result so async jobs and the UI can make
        the same decision.
        """

        uds = result_doc.get("uds") if isinstance(result_doc, dict) else None
        pathways = uds.get("pathways") if isinstance(uds, dict) else []
        uuid2smiles = uds.get("uuid2smiles") if isinstance(uds, dict) else {}
        pathways = pathways if isinstance(pathways, list) else []
        uuid2smiles = uuid2smiles if isinstance(uuid2smiles, dict) else {}

        first_step_reactions = [
            cls._pathway_first_step_reaction(pathway_edges, uuid2smiles)
            for pathway_edges in pathways
        ]
        first_step_reactions = [
            reaction for reaction in first_step_reactions
            if isinstance(reaction, str) and reaction
        ]
        family_counts = Counter(first_step_reactions)
        total_paths = len(pathways)
        required_route_count = MIN_ROUTE_OUTPUT_COUNT
        required_first_step_families = min(required_route_count, total_paths)
        unique_first_step_families = len(family_counts)
        route_count_ok = total_paths >= required_route_count
        first_step_family_ok = (
            route_count_ok
            and unique_first_step_families >= required_first_step_families
        )
        dominant_first_step_reaction = None
        dominant_first_step_count = 0
        if family_counts:
            dominant_first_step_reaction, dominant_first_step_count = family_counts.most_common(1)[0]

        blockers = []
        if not route_count_ok:
            blockers.append("minimum_route_count")
        if route_count_ok and not first_step_family_ok:
            blockers.append("first_step_family_diversity")

        return {
            "review_version": 1,
            "total_paths": total_paths,
            "required_route_count": required_route_count,
            "route_count_ok": route_count_ok,
            "unique_first_step_families": unique_first_step_families,
            "required_first_step_families": required_first_step_families,
            "first_step_family_ok": first_step_family_ok,
            "needs_repair": bool(blockers),
            "blockers": blockers,
            "dominant_first_step_reaction": dominant_first_step_reaction,
            "dominant_first_step_count": dominant_first_step_count,
            "first_step_family_counts": [
                {"reaction": reaction, "count": count}
                for reaction, count in family_counts.most_common(10)
            ],
        }

    @classmethod
    def merge_tree_builder_result_candidates(
        cls,
        primary_result_doc: dict,
        repair_result_doc: dict,
        repair_metadata: dict | None = None,
    ) -> dict:
        """Merge route candidates from an initial search and one repair search."""

        merged = copy.deepcopy(primary_result_doc)
        primary_uds = merged.get("uds") if isinstance(merged, dict) else None
        repair_uds = repair_result_doc.get("uds") if isinstance(repair_result_doc, dict) else None
        repair_metadata = dict(repair_metadata or {})

        merged["route_quality_repair"] = {
            **(merged.get("route_quality_repair") or {}),
            **repair_metadata,
            "attempted": True,
            "primary_total_paths": extract_tree_search_total_paths(primary_result_doc),
            "repair_total_paths": extract_tree_search_total_paths(repair_result_doc),
        }

        if not isinstance(primary_uds, dict) or not isinstance(repair_uds, dict):
            merged["route_quality_repair"]["merged"] = False
            merged["route_quality_repair"]["merge_reason"] = "missing_uds"
            return merged

        merged_uuid2smiles = dict(primary_uds.get("uuid2smiles") or {})
        repair_uuid2smiles = repair_uds.get("uuid2smiles") or {}
        uuid_remap: dict[str, str] = {}
        for uuid_value, smiles in repair_uuid2smiles.items():
            if uuid_value not in merged_uuid2smiles:
                merged_uuid2smiles[uuid_value] = smiles
                continue
            if merged_uuid2smiles[uuid_value] == smiles:
                continue
            repair_uuid = f"repair-{uuid_value}"
            suffix = 1
            while repair_uuid in merged_uuid2smiles:
                suffix += 1
                repair_uuid = f"repair-{suffix}-{uuid_value}"
            uuid_remap[uuid_value] = repair_uuid
            merged_uuid2smiles[repair_uuid] = smiles

        merged_node_dict = dict(primary_uds.get("node_dict") or {})
        for smiles, node in (repair_uds.get("node_dict") or {}).items():
            merged_node_dict.setdefault(smiles, node)

        merged_graph = list(primary_uds.get("graph") or [])
        seen_graph_edges = {
            (edge.get("source"), edge.get("target"))
            for edge in merged_graph
            if isinstance(edge, dict)
        }
        for edge in repair_uds.get("graph") or []:
            if not isinstance(edge, dict):
                continue
            edge_key = (edge.get("source"), edge.get("target"))
            if edge_key in seen_graph_edges:
                continue
            seen_graph_edges.add(edge_key)
            merged_graph.append(edge)

        merged_pathways = list(primary_uds.get("pathways") or [])
        for pathway_edges in repair_uds.get("pathways") or []:
            remapped_edges = []
            for edge in pathway_edges or []:
                remapped_edges.append({
                    "source": uuid_remap.get(edge.get("source"), edge.get("source")),
                    "target": uuid_remap.get(edge.get("target"), edge.get("target")),
                })
            merged_pathways.append(remapped_edges)

        merged_pathway_properties = list(primary_uds.get("pathways_properties") or [])
        merged_pathway_properties.extend(repair_uds.get("pathways_properties") or [])

        primary_uds["uuid2smiles"] = merged_uuid2smiles
        primary_uds["node_dict"] = merged_node_dict
        primary_uds["graph"] = merged_graph
        primary_uds["pathways"] = merged_pathways
        primary_uds["pathways_properties"] = merged_pathway_properties

        stats = dict(merged.get("stats") or {})
        stats["total_paths"] = len(merged_pathways)
        stats["synon_primary_total_paths"] = extract_tree_search_total_paths(primary_result_doc)
        stats["synon_repair_total_paths"] = extract_tree_search_total_paths(repair_result_doc)
        merged["stats"] = stats
        merged["route_quality_repair"]["merged"] = True
        merged["route_quality_repair"]["merged_candidate_paths"] = len(merged_pathways)
        merged["route_quality_review"] = cls.review_tree_builder_route_quality(merged)

        return merged

    @classmethod
    def _select_diverse_pathway_indices(
        cls,
        pathways: list,
        pathways_properties: list,
        uuid2smiles: dict,
        max_paths: int,
    ) -> list[int]:
        selected: list[int] = []
        selected_set: set[int] = set()
        indexed_families: list[tuple[int, tuple]] = []

        for index, pathway_edges in enumerate(pathways):
            properties = (
                pathways_properties[index]
                if index < len(pathways_properties)
                else {}
            )
            indexed_families.append((
                index,
                cls._pathway_family_key(
                    pathway_edges=pathway_edges,
                    properties=properties,
                    uuid2smiles=uuid2smiles,
                )
            ))

        seen_families: set[tuple] = set()
        for index, family_key in indexed_families:
            if family_key in seen_families:
                continue
            selected.append(index)
            selected_set.add(index)
            seen_families.add(family_key)
            if len(selected) >= max_paths:
                return selected

        for index, family_key in indexed_families:
            if index in selected_set:
                continue
            selected.append(index)
            selected_set.add(index)
            if len(selected) >= max_paths:
                break

        return selected

    @classmethod
    def compact_tree_builder_result_for_storage(cls, result_doc: dict) -> dict:
        """
        Keep persisted tree-builder results within MongoDB's document limit.

        The MCTS service can explore tens of thousands of nodes, while the UI
        only needs the enumerated pathways and the graph nodes/edges touched by
        those pathways. Persisting the full search graph can exceed MongoDB's
        16 MB document cap and leave a completed history item with no result.
        """
        uds = result_doc.get("uds") if isinstance(result_doc, dict) else None
        if not isinstance(uds, dict):
            return result_doc

        all_pathways = uds.get("pathways") or []
        all_pathway_properties = uds.get("pathways_properties") or []
        uuid2smiles = uds.get("uuid2smiles") or {}
        node_dict = uds.get("node_dict") or {}
        graph_edges = uds.get("graph") or []
        if not all_pathways:
            compacted = copy.deepcopy(result_doc)
            stats = dict(compacted.get("stats") or {})
            stats["total_paths"] = 0
            compacted["stats"] = stats
            compacted["uds"] = None
            compacted["storage"] = {
                **(compacted.get("storage") or {}),
                "compacted": True,
                "reason": "unsolved_tree_without_paths",
                "original_node_count": len(node_dict),
                "original_graph_edge_count": len(graph_edges),
                "frontier_summary": cls._build_unsolved_frontier_summary(uds),
            }
            return compacted
        if not uuid2smiles or not node_dict:
            compacted = copy.deepcopy(result_doc)
            stats = dict(compacted.get("stats") or {})
            stats["total_paths"] = 0
            compacted["stats"] = stats
            compacted["uds"] = None
            compacted["storage"] = {
                **(compacted.get("storage") or {}),
                "compacted": True,
                "reason": "missing_uds_route_index",
                "original_node_count": len(node_dict),
                "original_graph_edge_count": len(graph_edges),
            }
            return compacted
        selected_pathway_indices = cls._select_diverse_pathway_indices(
            pathways=all_pathways,
            pathways_properties=all_pathway_properties,
            uuid2smiles=uuid2smiles,
            max_paths=10,
        )
        pathways = [all_pathways[index] for index in selected_pathway_indices]
        selected_pathway_properties = [
            all_pathway_properties[index]
            if index < len(all_pathway_properties)
            else {}
            for index in selected_pathway_indices
        ]

        kept_uuids: set[str] = set()
        for pathway_edges in pathways:
            for edge in pathway_edges or []:
                source = edge.get("source")
                target = edge.get("target")
                if source is not None:
                    kept_uuids.add(source)
                if target is not None:
                    kept_uuids.add(target)

        kept_smiles = {
            smiles for uuid, smiles in uuid2smiles.items()
            if uuid in kept_uuids
        }
        if not kept_smiles:
            return result_doc

        compacted = copy.deepcopy(result_doc)
        compacted_uds = compacted["uds"]
        original_node_count = len(node_dict)
        original_edge_count = len(graph_edges)

        compacted_uds["uuid2smiles"] = {
            uuid: smiles for uuid, smiles in uuid2smiles.items()
            if uuid in kept_uuids
        }
        compacted_node_dict = {}
        for smiles_or_uuid, node in node_dict.items():
            if smiles_or_uuid in kept_smiles:
                smiles = smiles_or_uuid
            else:
                node_smiles = node.get("smiles") if isinstance(node, dict) else None
                smiles = node_smiles if node_smiles in kept_smiles else None
            if not smiles:
                continue
            compacted_node = cls._compact_uds_node(node)
            if "smiles" not in compacted_node:
                compacted_node["smiles"] = smiles
            if "id" not in compacted_node:
                compacted_node["id"] = smiles
            compacted_node_dict[smiles] = compacted_node
        compacted_uds["node_dict"] = compacted_node_dict
        compacted_uds["pathways"] = [
            [cls._compact_uds_edge(edge) for edge in pathway_edges or []]
            for pathway_edges in pathways
        ]
        compacted_uds["pathways_properties"] = [
            cls._compact_pathway_properties(properties)
            for properties in selected_pathway_properties[:len(pathways)]
        ]
        while len(compacted_uds["pathways_properties"]) < len(pathways):
            compacted_uds["pathways_properties"].append({})
        stats = dict(compacted.get("stats") or {})
        stats["total_paths"] = len(compacted_uds["pathways"])
        compacted["stats"] = stats
        compacted["route_quality_review"] = cls.review_tree_builder_route_quality(compacted)

        compact_graph_edges = []
        seen_edges = set()
        for edge in graph_edges:
            source = edge.get("source")
            target = edge.get("target")
            if source not in kept_smiles or target not in kept_smiles:
                continue
            edge_key = (source, target)
            if edge_key in seen_edges:
                continue
            seen_edges.add(edge_key)
            compact_graph_edges.append(cls._compact_uds_edge(edge))
        compacted_uds["graph"] = compact_graph_edges

        if (
            len(compacted_uds["node_dict"]) != original_node_count
            or len(compacted_uds["graph"]) != original_edge_count
        ):
            compacted["storage"] = {
                "compacted": True,
                "reason": "route_path_union_only",
                "original_node_count": original_node_count,
                "saved_node_count": len(compacted_uds["node_dict"]),
                "original_graph_edge_count": original_edge_count,
                "saved_graph_edge_count": len(compacted_uds["graph"]),
            }

        return compacted

    @classmethod
    def _build_unsolved_frontier_summary(
        cls,
        uds: dict,
        limit: int = 50,
        root_reaction_limit: int = 200,
    ) -> dict:
        node_dict = uds.get("node_dict") or {}
        graph_edges = uds.get("graph") or []
        outgoing: set[str] = set()
        incoming: set[str] = set()
        children: dict[str, list[str]] = {}
        for edge in graph_edges:
            if not isinstance(edge, dict):
                continue
            source = str(edge.get("source") or "")
            target = str(edge.get("target") or "")
            if source:
                outgoing.add(source)
                children.setdefault(source, []).append(target)
            if target:
                incoming.add(target)

        frontier = []
        reactions = []
        nodes_by_id: dict[str, tuple[str, dict]] = {}
        for key, node in node_dict.items():
            if not isinstance(node, dict):
                continue
            node_id = str(node.get("id") or key)
            smiles = str(node.get("smiles") or key)
            nodes_by_id[node_id] = (smiles, node)
            node_type = str(node.get("type") or "")
            if node_type == "reaction" or ">>" in smiles:
                reactions.append(cls._compact_frontier_node(node_id, smiles, node))
                continue
            if node_type and node_type != "chemical":
                continue
            if node_id in outgoing:
                continue
            frontier.append(cls._compact_frontier_node(node_id, smiles, node))

        frontier.sort(
            key=lambda item: (
                item.get("in_stock") is not True and not cls._positive_number(item.get("purchase_price")),
                item.get("heavy_atom_count") if isinstance(item.get("heavy_atom_count"), int) else 10**9,
                -(item.get("score") if isinstance(item.get("score"), int | float) else -1),
                item.get("smiles") or "",
            ),
        )
        reactions.sort(
            key=lambda item: (
                item.get("score") if isinstance(item.get("score"), int | float) else -1,
                item.get("smiles") or "",
            ),
            reverse=True,
        )
        root_reactions = []
        root_ids = [
            node_id
            for node_id, (_, node) in nodes_by_id.items()
            if str(node.get("type") or "") == "chemical"
            and node_id in outgoing
            and node_id not in incoming
        ]
        for root_id in root_ids:
            product_smiles, _ = nodes_by_id[root_id]
            for reaction_id in children.get(root_id, []):
                reaction_entry = nodes_by_id.get(reaction_id)
                if reaction_entry is None:
                    continue
                reaction_smiles, reaction_node = reaction_entry
                if str(reaction_node.get("type") or "") != "reaction" and ">>" not in reaction_smiles:
                    continue
                precursor_smiles = []
                for child_id in children.get(reaction_id, []):
                    child_entry = nodes_by_id.get(child_id)
                    if child_entry is None:
                        continue
                    child_smiles, child_node = child_entry
                    if str(child_node.get("type") or "") == "chemical":
                        precursor_smiles.append(child_smiles)
                compacted_reaction = cls._compact_frontier_node(
                    reaction_id,
                    reaction_smiles,
                    reaction_node,
                )
                compacted_reaction["product_smiles"] = product_smiles
                compacted_reaction["precursors"] = list(dict.fromkeys(precursor_smiles))
                root_reactions.append(compacted_reaction)
        root_reactions.sort(
            key=lambda item: (
                item.get("score") if isinstance(item.get("score"), int | float) else -1,
                item.get("smiles") or "",
            ),
            reverse=True,
        )
        return {
            "frontier_leaf_count": len(frontier),
            "reaction_node_count": len(reactions),
            "top_frontier_leaves": frontier[:limit],
            "top_reactions": reactions[:limit],
            "root_reactions": root_reactions[:root_reaction_limit],
        }

    @classmethod
    def _compact_frontier_node(cls, node_id: str, smiles: str, node: dict) -> dict:
        compacted = {
            "id": node_id,
            "smiles": smiles,
        }
        for key in (
            "type",
            "in_stock",
            "purchase_price",
            "rxn_score_from_model",
            "plausibility",
            "template_score",
            "template_id",
            "rank",
            "depth",
        ):
            if key in node and node.get(key) is not None:
                compacted[key] = node.get(key)
        for score_key in (
            "rxn_score_from_model",
            "plausibility",
            "template_score",
        ):
            if isinstance(node.get(score_key), int | float):
                compacted["score"] = node.get(score_key)
                break
        heavy_atom_count = cls._heavy_atom_count(smiles)
        if heavy_atom_count is not None:
            compacted["heavy_atom_count"] = heavy_atom_count
        return compacted

    @staticmethod
    def _positive_number(value: Any) -> bool:
        return isinstance(value, int | float) and float(value) > 0

    @staticmethod
    def _heavy_atom_count(smiles: str) -> int | None:
        try:
            mol = Chem.MolFromSmiles(smiles)
        except Exception:
            return None
        if mol is None:
            return None
        return sum(1 for atom in mol.GetAtoms() if atom.GetAtomicNum() > 1)

    @classmethod
    def minimal_tree_builder_result_for_storage(cls, result_doc: dict) -> dict:
        """
        Last-resort storage format for very large searches.

        It preserves the selected pathways and node labels so the result can be
        opened, while dropping the full explored graph. This is preferable to
        leaving the task in a permanent started/failed state after a successful
        search.
        """
        compacted = cls.compact_tree_builder_result_for_storage(result_doc)
        uds = compacted.get("uds") if isinstance(compacted, dict) else None
        if isinstance(uds, dict):
            uds["graph"] = []
            uds["pathways_properties"] = [
                cls._compact_pathway_properties(properties)
                for properties in (uds.get("pathways_properties") or [])[
                    :len(uds.get("pathways") or [])
                ]
            ]
            while len(uds["pathways_properties"]) < len(uds.get("pathways") or []):
                uds["pathways_properties"].append({})
        compacted["storage"] = {
            **(compacted.get("storage") or {}),
            "minimal": True,
            "reason": "mongo_document_limit",
        }
        return compacted

    @classmethod
    def build_unclosed_tree_failure_update(
        cls,
        result_doc: dict,
        error: str | None = None,
        modified: datetime | None = None,
    ) -> dict:
        """Persist an unsolved search as failed without dropping search diagnostics."""

        modified = modified or datetime.now()
        result_doc = copy.deepcopy(result_doc if isinstance(result_doc, dict) else {})
        result_doc = cls.compact_tree_builder_result_for_storage(result_doc)
        stats = dict(result_doc.get("stats") or {})
        stats["total_paths"] = extract_tree_search_total_paths(result_doc)
        result_doc["stats"] = stats
        result_doc["status"] = "FAILED"
        result_doc["error"] = str(error or UNCLOSED_TREE_FAILURE_MESSAGE)
        result_doc["route_quality_review"] = cls.review_tree_builder_route_quality(result_doc)

        return {
            "$set": {
                "result_state": "failed",
                "result": result_doc,
                "num_trees": 0,
                "modified": modified,
            }
        }

    def list(self, token: Annotated[str, Depends(oauth2_scheme)]
             ) -> list[TreeSearchSavedResults]:
        """
        API endpoint for accessing user results list.

        Method: GET

        Returns: list of tree builder results belonging to or shared with the currently
            authenticated user
        """
        user_controller = get_util_registry().get_util(module="user_controller")
        user = user_controller.get_current_user(token)
        self.reconcile_incomplete_results_for_user(user.username)

        query = {
            "$or": [
                {"user": user.username},
                {"public": True},
                {"shared_with": user.username},
            ]
        }
        # unsetting the result and settings fields to avoid gigantic returns
        cursor = self.collection.aggregate(
            [
                {"$match": query},
                {"$unset": ["result", "settings"]},
                {"$sort": {"modified": -1, "created": -1}}
            ]
        )
        results = []
        for r in cursor:
            result = TreeSearchSavedResults(**r)
            results.append(result)

        return results

    def retrieve_pathway_metadata(self, result: dict, pathways_properties_only=True):
        try:
            Metadata(**result)
        except Exception as e:
            raise HTTPException(
                status_code=404,
                detail=f"{e}"
            )
        result = standardize_result_tb(result)
        if pathways_properties_only:
            return result["uds"]["pathways_properties"]
        else:
            return result


    def retrieve(self, result_id: str, token: Annotated[str, Depends(oauth2_scheme)]
                 ) -> TreeSearchSavedResults:
        """
        API endpoint to retrieve specified result by result_id.

        Method: GET
        """

        user_controller = get_util_registry().get_util(module="user_controller")
        user = user_controller.get_current_user(token)
        self.reconcile_incomplete_results_for_user(user.username)

        query = {
            "result_id": result_id,
            "$or": [
                {"user": user.username},
                {"public": True},
                {"shared_with": user.username},
            ]
        }
        result = self.collection.find_one(query)
        if not result:
            raise HTTPException(
                status_code=404,
                detail=f"Result with id {result_id} not found or not viewable!"
            )
        result["_id"] = str(result["_id"])

        if result["result_state"] in ["completed", "ipp"]:

            if result["result_type"] == "ipp":
                try:
                    result["result"] = standardize_result_ipp(result["result"])
                except:
                    # return results without formatting - frontend 
                    raise HTTPException(
                        status_code=500,
                        detail=f"Unable to standardize ipp result for id: {result_id}!"
                    )
                # by pass tb result check
                return result

            elif result["result_type"] == "tree_builder":
                tree_result = result.get("result") or {}
                if extract_tree_search_total_paths(tree_result) > 0 and tree_result.get("uds"):
                    try:
                        result["result"] = standardize_result_tb(tree_result)
                    except:
                        raise HTTPException(
                            status_code=500,
                            detail=f"Unable to standardize tb result for id: {result_id}!"
                        )

            result = TreeSearchSavedResults(**result)

            return result
        else:
            return TreeSearchSavedResults(**result)

    def create(
        self,
        result: TreeSearchSavedResults,
        token: Annotated[str, Depends(oauth2_scheme)]
    ) -> Response:
        """
        API endpoint to create a result.

        Method: POST
        """
        user_controller = get_util_registry().get_util(module="user_controller")
        user = user_controller.get_current_user(token)

        if not result.user:
            # This implies this is a create call from IPP
            result.user = user.username
            result.shared_with = [user.username]
            result.result_type = "ipp"
            result.result_state = "completed"

            if not result.result_id:
                result.result_id = str(uuid.uuid4())

        self.collection.insert_one(result.model_dump())

        resp = {
            "success": True,
            "id": result.result_id,
            "modified": result.modified.isoformat(timespec="milliseconds"),
            "message": f"Successfully create a result for user: {user.username}!"
        }

        return Response(
            content=json.dumps(resp),
            status_code=201,
            media_type="application/json"
        )

    def update(
        self,
        result_id: str,
        updated_result: dict,
        token: Annotated[str, Depends(oauth2_scheme)]
    ) -> Response:
        """
        API endpoint to update a result.

        Method: PUT
        """
        user_controller = get_util_registry().get_util(module="user_controller")
        user = user_controller.get_current_user(token)

        query = {
            "result_id": result_id,
            "revision": updated_result["revision"] - 1,
            "$or": [
                {"user": user.username},
                {
                    "public": True,
                    "shared_with": user.username
                }
            ]
        }
        updated_result = {
            k: v for k, v in updated_result.items() if k in [
                "result", "settings", "description", "tags", "modified", "revision"
            ] and v
        }
        res = self.collection.update_one(
            query,
            {"$set": updated_result}
        )
        if not res.matched_count:
            resp = {
                "success": False,
                "error": f"Result {result_id} not editable by user {user.username}, "
                         f"or result changed since initial access!"
            }
            return Response(
                content=json.dumps(resp),
                status_code=404,
                media_type="application/json"
            )
        else:
            resp = {
                "success": True,
                "id": result_id,
                "modified": updated_result.get(
                    "modified", datetime.now()
                ).isoformat(timespec="milliseconds"),
                "message": f"Successfully update result {result_id}!"
            }
            return Response(
                content=json.dumps(resp),
                status_code=200,
                media_type="application/json"
            )

    def destroy(self, result_id: str, token: Annotated[str, Depends(oauth2_scheme)]
                ) -> Response:
        """
        API endpoint to delete specified result by result_id.

        Method: DELETE
        """

        user_controller = get_util_registry().get_util(module="user_controller")
        user = user_controller.get_current_user(token)

        query = {
            "user": user.username,
            "result_id": result_id
        }
        try:
            res = self.collection.delete_one(query)
        except Exception:
            resp = {
                "success": False,
                "message": f"Could not delete result {result_id}!"
            }
            return Response(
                content=json.dumps(resp),
                status_code=500,
                media_type="application/json"
            )
        if not res.deleted_count:
            resp = {
                "success": False,
                "message": f"Failed to delete result {result_id}!"
            }
            return Response(
                content=json.dumps(resp),
                status_code=500,
                media_type="application/json"
            )
        else:
            resp = {
                "success": True,
                "message": f"Successfully delete result: {result_id}!"
            }
            return Response(
                content=json.dumps(resp),
                status_code=200,
                media_type="application/json"
            )

    def share(self, result_id: str, token: Annotated[str, Depends(oauth2_scheme)]
              ) -> Response:
        """
        API endpoint to make public specific result by result_id.

        Method: GET
        """
        resp = {"id": result_id, "url": None, "error": None, "message": None}

        user_controller = get_util_registry().get_util(module="user_controller")
        user = user_controller.get_current_user(token)

        query = {
            "user": user.username,
            "result_id": result_id
        }
        res = self.collection.update_one(
            query,
            {"$set": {"public": True}}
        )
        if not res.matched_count:
            resp["error"] = f"Result {result_id} not editable by user {user.username}!"

            return Response(
                content=json.dumps(resp),
                status_code=401,
                media_type="application/json"
            )
        else:
            resp["url"] = f"/results?shared={result_id}"
            resp["message"] = f"Successfully make result public: {result_id}!"

            return Response(
                content=json.dumps(resp),
                status_code=200,
                media_type="application/json"
            )

    def unshare(self, result_id: str, token: Annotated[str, Depends(oauth2_scheme)]
                ) -> Response:
        """
        API endpoint to make private specific result by result_id.

        Method: GET
        """

        user_controller = get_util_registry().get_util(module="user_controller")
        user = user_controller.get_current_user(token)

        query = {
            "user": user.username,
            "result_id": result_id
        }
        res = self.collection.update_one(
            query,
            {"$set": {"public": False}}
        )
        if not res.matched_count:
            content = {
                "message": f"Result {result_id} not editable by user {user.username}!"
            }
            return Response(
                content=json.dumps(content),
                status_code=401,
                media_type="application/json"
            )
        else:
            return Response(content=f"Successfully make result private: {result_id}!")

    def add(self, result_id: str, token: Annotated[str, Depends(oauth2_scheme)]
            ) -> Response:
        """
        API endpoint to add specified result to the current user by result_id.

        Method: PUT
        """
        resp = {"id": result_id, "result": None, "error": None, "message": None}

        user_controller = get_util_registry().get_util(module="user_controller")
        user = user_controller.get_current_user(token)

        query = {
            "result_id": result_id,
            "public": True
        }
        res = self.collection.update_one(
            query,
            {"$push": {"shared_with": user.username}}
        )
        if not res.matched_count:
            resp["error"] = f"Result {result_id} not found or is not public!"

            return Response(
                content=json.dumps(resp),
                status_code=404,
                media_type="application/json"
            )
        else:
            resp["message"] = f"Successfully share result {result_id} for user: " \
                              f"{user.username}!"
            result = self.retrieve(result_id=result_id, token=token)
            resp["result"] = {
                "id": result.result_id,
                "state": result.result_state,
                "description": result.description,
                "created": result.created.strftime("%B %d, %Y %H:%M:%S %p UTC"),
                "modified": result.modified.strftime("%B %d, %Y %H:%M:%S %p UTC"),
                "type": result.result_type,
                "public": result.public,
                "tags": result.tags
            }

            if (
                    result.result_type == "tree_builder"
                    and result.result_state == "completed"
            ):
                resp["result"]["num_trees"] = result.num_trees

            return Response(
                content=json.dumps(resp),
                status_code=200,
                media_type="application/json"
            )

    def remove(self, result_id: str, token: Annotated[str, Depends(oauth2_scheme)]
               ) -> Response:
        """
        API endpoint to remove specified result to the current user by result_id.

        Method: DELETE
        """

        user_controller = get_util_registry().get_util(module="user_controller")
        user = user_controller.get_current_user(token)

        query = {
            "result_id": result_id,
            "public": True
        }
        res = self.collection.update_one(
            query,
            {"$pull": {"shared_with": user.username}}
        )
        if not res.matched_count:
            content = {
                "message": f"Result {result_id} not found or is not public!"
            }
            return Response(
                content=json.dumps(content),
                status_code=404,
                media_type="application/json"
            )
        else:
            return Response(content=f"Successfully unshare result {result_id} for "
                                    f"user: {user.username}!")

    def update_result_state(
        self,
        result_id: str,
        state: str,
        token: Annotated[str | None, Depends(oauth2_scheme)] = None
    ) -> None:
        user_controller = get_util_registry().get_util(module="user_controller")
        user = user_controller.get_current_user(token)

        query = {
            "user": user.username,
            "result_id": result_id
        }
        self.collection.update_one(
            query,
            {"$set": {"result_state": state, "modified": datetime.now()}}
        )

    def set_task_id(
        self,
        result_id: str,
        task_id: str,
        token: Annotated[str | None, Depends(oauth2_scheme)] = None
    ) -> None:
        user_controller = get_util_registry().get_util(module="user_controller")
        user = user_controller.get_current_user(token)

        query = {
            "user": user.username,
            "result_id": result_id
        }
        self.collection.update_one(
            query,
            {"$set": {"task_id": task_id, "modified": datetime.now()}}
        )

    def record_failure(
        self,
        result_id: str,
        error: str,
        token: Annotated[str | None, Depends(oauth2_scheme)] = None
    ) -> None:
        user_controller = get_util_registry().get_util(module="user_controller")
        user = user_controller.get_current_user(token)

        query = {
            "user": user.username,
            "result_id": result_id
        }
        self.collection.update_one(query, build_tree_search_failure_update(error))

    def record_unclosed_result_failure(
        self,
        result_id: str,
        result: BaseModel | dict,
        error: str | None = None,
        token: Annotated[str | None, Depends(oauth2_scheme)] = None
    ) -> None:
        user_controller = get_util_registry().get_util(module="user_controller")
        user = user_controller.get_current_user(token)

        query = {
            "user": user.username,
            "result_id": result_id
        }
        result_doc = result.model_dump() if isinstance(result, BaseModel) else result
        if isinstance(result_doc, dict) and ("result_id" not in result_doc or not result_doc["result_id"]):
            result_doc["result_id"] = result_id
        self.collection.update_one(
            query,
            self.build_unclosed_tree_failure_update(
                result_doc=result_doc,
                error=error,
            ),
        )

    def save_results(
        self,
        result_id: str,
        result: BaseModel,
        token: Annotated[str | None, Depends(oauth2_scheme)] = None
    ) -> None:
        user_controller = get_util_registry().get_util(module="user_controller")
        user = user_controller.get_current_user(token)

        query = {
            "user": user.username,
            "result_id": result_id
        }
        result_doc = result.model_dump()
        if "result_id" not in result_doc or not result_doc["result_id"]:
            result_doc["result_id"] = result_id
        result_doc = self.compact_tree_builder_result_for_storage(result_doc)
        total_paths = extract_tree_search_total_paths(result_doc)

        update = {"$set": {
            "result": result_doc,
            "num_trees": total_paths,
            "modified": datetime.now(),
        }}
        try:
            self.collection.update_one(query, update)
        except errors.DocumentTooLarge:
            result_doc = self.minimal_tree_builder_result_for_storage(result_doc)
            total_paths = extract_tree_search_total_paths(result_doc)
            self.collection.update_one(
                query,
                {"$set": {
                    "result": result_doc,
                    "num_trees": total_paths,
                    "modified": datetime.now(),
                }}
            )
