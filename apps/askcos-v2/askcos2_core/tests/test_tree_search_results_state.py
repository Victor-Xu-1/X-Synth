from datetime import datetime, timedelta

import pytest
import utils.tree_search_results as tree_search_results_module
from utils.tree_search_results import (
    TreeSearchResultsController,
    TreeSearchSavedResults,
    build_tree_search_failure_update,
    extract_tree_search_total_paths,
)
from utils.tree_search_results_util import standardize_result_tb


def test_extract_tree_search_total_paths_prefers_stats():
    result_doc = {
        "stats": {"total_paths": "7"},
        "uds": {"pathways": [[], []]},
    }

    assert extract_tree_search_total_paths(result_doc) == 7


def test_extract_tree_search_total_paths_falls_back_to_pathways():
    result_doc = {
        "stats": {},
        "uds": {"pathways": [[], [], []]},
    }

    assert extract_tree_search_total_paths(result_doc) == 3


def test_extract_tree_search_total_paths_handles_empty_failed_result():
    assert extract_tree_search_total_paths({"error": "backend unavailable"}) == 0
    assert extract_tree_search_total_paths(None) == 0


def test_build_tree_search_failure_update_preserves_error_details():
    modified = datetime(2026, 6, 28, 12, 0, 0)

    update = build_tree_search_failure_update(
        error="MCTS backend returned no buyable route",
        modified=modified,
    )

    assert update["$set"]["result_state"] == "failed"
    assert update["$set"]["num_trees"] == 0
    assert update["$set"]["modified"] == modified
    assert update["$set"]["result"]["status"] == "FAILED"
    assert update["$set"]["result"]["error"] == "MCTS backend returned no buyable route"


def test_build_unclosed_tree_failure_update_preserves_search_diagnostics():
    modified = datetime(2026, 6, 28, 12, 30, 0)
    result_doc = {
        "status": "SUCCESS",
        "stats": {
            "total_paths": 0,
            "total_iterations": 18,
            "total_chemicals": 664,
            "total_reactions": 675,
        },
        "uds": {
            "uuid2smiles": {},
            "node_dict": {"target": {"smiles": "CCO", "type": "chemical"}},
            "graph": [{"source": "a", "target": "b"}],
            "pathways": [],
        },
        "route_quality_review": {"needs_repair": True, "blockers": ["minimum_route_count"]},
    }

    update = TreeSearchResultsController.build_unclosed_tree_failure_update(
        result_doc=result_doc,
        error="No closed buyable route after expanded search.",
        modified=modified,
    )

    stored = update["$set"]["result"]
    assert update["$set"]["result_state"] == "failed"
    assert update["$set"]["num_trees"] == 0
    assert update["$set"]["modified"] == modified
    assert stored["status"] == "FAILED"
    assert stored["error"] == "No closed buyable route after expanded search."
    assert stored["stats"]["total_paths"] == 0
    assert stored["stats"]["total_chemicals"] == 664
    assert stored["storage"]["reason"] == "unsolved_tree_without_paths"
    assert stored["storage"]["frontier_summary"]["frontier_leaf_count"] >= 1
    assert stored["storage"]["frontier_summary"]["top_frontier_leaves"][0]["smiles"] == "CCO"
    assert stored["route_quality_review"]["blockers"] == ["minimum_route_count"]


def test_saved_result_accepts_celery_task_id():
    result = TreeSearchSavedResults(result_id="result-1", task_id="task-1")

    assert result.task_id == "task-1"


def test_saved_result_preserves_unified_route_pool_summary():
    result = TreeSearchSavedResults(
        result_id="result-1",
        task_id="task-1",
        unified_route_pool_summary={
            "version": 1,
            "selected_route_count": 10,
            "engine_counts": {"askcos_retro_star": 9, "aizynthfinder": 1},
        },
    )

    assert result.unified_route_pool_summary["selected_route_count"] == 10
    assert result.unified_route_pool_summary["engine_counts"]["aizynthfinder"] == 1


def test_compact_tree_builder_result_for_storage_is_callable_from_instance():
    controller = object.__new__(TreeSearchResultsController)
    result_doc = {"status": "DONE", "uds": {}}

    compacted = TreeSearchResultsController.compact_tree_builder_result_for_storage(
        result_doc
    )

    assert compacted["stats"]["total_paths"] == 0
    assert compacted["uds"] is None
    assert compacted["storage"]["reason"] == "unsolved_tree_without_paths"
    assert compacted["storage"]["frontier_summary"]["frontier_leaf_count"] == 0
    assert controller.compact_tree_builder_result_for_storage(result_doc) == compacted


def test_compact_tree_builder_result_keeps_route_fields_and_trims_properties():
    result_doc = {
        "uds": {
            "uuid2smiles": {
                "target-u": "CCO",
                "rxn-u": "CCO>>CC",
                "precursor-u": "CC",
                "unused-u": "CCCC",
            },
            "node_dict": {
                "CCO": {
                    "id": "CCO",
                    "smiles": "CCO",
                    "type": "chemical",
                    "purchase_price": 1.2,
                    "backend_payload": "x" * 1000,
                },
                "CCO>>CC": {
                    "id": "CCO>>CC",
                    "smiles": "CCO>>CC",
                    "type": "reaction",
                    "rxn_score_from_model": 0.7,
                    "template_set": "pistachio",
                    "template_score": 0.9,
                    "template_rank": 1,
                    "tforms": ["patent-template-1"],
                    "tsources": ["pistachio"],
                    "retro_backend": "template_relevance",
                    "retro_model_name": "pistachio",
                    "precursor_properties": {
                        "num_rings": 1,
                        "rms_molwt": 44.1,
                        "scscore": 2.3,
                        "precursor_prices": {"CC": {"ppg": 0.5}},
                        "large_payload": "x" * 1000,
                    },
                    "large_template_examples": ["x" * 1000],
                },
                "CC": {
                    "id": "CC",
                    "smiles": "CC",
                    "type": "chemical",
                    "purchase_price": 0.5,
                },
                "CCCC": {"id": "CCCC", "smiles": "CCCC", "type": "chemical"},
            },
            "graph": [
                {"source": "CCO", "target": "CCO>>CC", "extra": "drop"},
                {"source": "CCO>>CC", "target": "CC", "extra": "drop"},
                {"source": "CCCC", "target": "CCO>>CC", "extra": "drop"},
            ],
            "pathways": [
                [
                    {"source": "target-u", "target": "rxn-u", "extra": "drop"},
                    {"source": "rxn-u", "target": "precursor-u", "extra": "drop"},
                ]
            ],
            "pathways_properties": [
                {"depth": 1, "score": 0.5, "large_payload": "x" * 1000}
            ],
        },
    }

    compacted = TreeSearchResultsController.compact_tree_builder_result_for_storage(
        result_doc
    )

    uds = compacted["uds"]
    assert set(uds["node_dict"]) == {"CCO", "CCO>>CC", "CC"}
    assert "backend_payload" not in uds["node_dict"]["CCO"]
    assert uds["node_dict"]["CCO"]["purchase_price"] == 1.2
    assert uds["node_dict"]["CCO>>CC"]["template_set"] == "pistachio"
    assert uds["node_dict"]["CCO>>CC"]["template_score"] == 0.9
    assert uds["node_dict"]["CCO>>CC"]["template_rank"] == 1
    assert uds["node_dict"]["CCO>>CC"]["tforms"] == ["patent-template-1"]
    assert uds["node_dict"]["CCO>>CC"]["tsources"] == ["pistachio"]
    assert uds["node_dict"]["CCO>>CC"]["retro_model_name"] == "pistachio"
    assert uds["node_dict"]["CCO>>CC"]["precursor_properties"] == {
        "num_rings": 1,
        "rms_molwt": 44.1,
        "scscore": 2.3,
        "precursor_prices": {"CC": {"ppg": 0.5}},
    }
    assert uds["pathways_properties"] == [{"depth": 1, "score": 0.5}]
    assert compacted["stats"]["total_paths"] == 1


def test_compact_tree_builder_result_selects_diverse_candidates_before_trimming():
    uuid2smiles = {"target-u": "CCO"}
    node_dict = {
        "CCO": {"id": "CCO", "smiles": "CCO", "type": "chemical"},
    }
    graph = []
    pathways = []
    pathways_properties = []

    for index in range(12):
        rxn_uuid = f"rxn-{index}"
        precursor_uuid = f"precursor-{index}"
        if index < 10:
            reaction_smiles = "CCO>>CC"
            cluster_id = 1
        else:
            reaction_smiles = f"CCO>>CC{index}"
            cluster_id = index

        precursor_smiles = f"CC{index}"
        uuid2smiles[rxn_uuid] = reaction_smiles
        uuid2smiles[precursor_uuid] = precursor_smiles
        node_dict[reaction_smiles] = {
            "id": reaction_smiles,
            "smiles": reaction_smiles,
            "type": "reaction",
        }
        node_dict[precursor_smiles] = {
            "id": precursor_smiles,
            "smiles": precursor_smiles,
            "type": "chemical",
        }
        edge_a = {"source": "target-u", "target": rxn_uuid}
        edge_b = {"source": rxn_uuid, "target": precursor_uuid}
        pathways.append([edge_a, edge_b])
        graph.extend([
            {"source": "CCO", "target": reaction_smiles},
            {"source": reaction_smiles, "target": precursor_smiles},
        ])
        pathways_properties.append({
            "cluster_id": cluster_id,
            "score": 100 - index,
            "depth": 1,
        })

    result_doc = {
        "uds": {
            "uuid2smiles": uuid2smiles,
            "node_dict": node_dict,
            "graph": graph,
            "pathways": pathways,
            "pathways_properties": pathways_properties,
        },
    }

    compacted = TreeSearchResultsController.compact_tree_builder_result_for_storage(
        result_doc
    )

    selected_clusters = [
        item.get("cluster_id")
        for item in compacted["uds"]["pathways_properties"]
    ]
    assert selected_clusters == [1, 10, 11, 1, 1, 1, 1, 1, 1, 1]
    assert len(compacted["uds"]["pathways"]) == 10
    assert compacted["stats"]["total_paths"] == 10
    assert extract_tree_search_total_paths(compacted) == 10


def test_select_diverse_pathways_prioritizes_unique_first_steps():
    uuid2smiles = {
        "target": "T",
        "r1a": "A>>T",
        "r1b": "B>>T",
        "r2a": "A1>>A",
        "r2b": "A2>>A",
        "p1": "A",
        "p2": "B",
        "p3": "A1",
        "p4": "A2",
    }
    pathways = [
        [{"source": "target", "target": "r1a"}, {"source": "r1a", "target": "p1"}, {"source": "p1", "target": "r2a"}],
        [{"source": "target", "target": "r1a"}, {"source": "r1a", "target": "p1"}, {"source": "p1", "target": "r2b"}],
        [{"source": "target", "target": "r1b"}, {"source": "r1b", "target": "p2"}],
    ]

    selected = TreeSearchResultsController._select_diverse_pathway_indices(
        pathways=pathways,
        pathways_properties=[{}, {}, {}],
        uuid2smiles=uuid2smiles,
        max_paths=3,
    )

    assert selected[:2] == [0, 2]


def test_select_diverse_pathways_fills_remaining_slots_when_families_are_sparse():
    uuid2smiles = {
        "target": "T",
        "r1a": "A>>T",
        "r1b": "B>>T",
        "p1": "A",
        "p2": "B",
        "p3": "A2",
        "p4": "B2",
    }
    pathways = [
        [{"source": "target", "target": "r1a"}, {"source": "r1a", "target": "p1"}],
        [{"source": "target", "target": "r1b"}, {"source": "r1b", "target": "p2"}],
        [{"source": "target", "target": "r1a"}, {"source": "r1a", "target": "p3"}],
        [{"source": "target", "target": "r1b"}, {"source": "r1b", "target": "p4"}],
    ]

    selected = TreeSearchResultsController._select_diverse_pathway_indices(
        pathways=pathways,
        pathways_properties=[{}, {}, {}, {}],
        uuid2smiles=uuid2smiles,
        max_paths=10,
    )

    assert selected == [0, 1, 2, 3]


def test_review_tree_builder_route_quality_flags_single_root_family_for_repair():
    uuid2smiles = {"target": "T"}
    pathways = []
    pathways_properties = []
    for index in range(6):
        reaction_uuid = f"r{index}"
        precursor_uuid = f"p{index}"
        uuid2smiles[reaction_uuid] = "A>>T"
        uuid2smiles[precursor_uuid] = f"A{index}"
        pathways.append([
            {"source": "target", "target": reaction_uuid},
            {"source": reaction_uuid, "target": precursor_uuid},
        ])
        pathways_properties.append({"score": -index})

    review = TreeSearchResultsController.review_tree_builder_route_quality({
        "uds": {
            "uuid2smiles": uuid2smiles,
            "pathways": pathways,
            "pathways_properties": pathways_properties,
        },
        "stats": {"total_paths": 6},
    })

    assert review["needs_repair"] is True
    assert review["route_count_ok"] is True
    assert review["first_step_family_ok"] is False
    assert review["unique_first_step_families"] == 1
    assert review["dominant_first_step_reaction"] == "A>>T"


def test_merge_tree_builder_result_candidates_preserves_repair_route_families():
    def make_result(reactions):
        uuid2smiles = {"target": "T"}
        node_dict = {"T": {"id": "T", "smiles": "T", "type": "chemical"}}
        graph = []
        pathways = []
        pathways_properties = []
        for index, reaction in enumerate(reactions):
            reaction_uuid = f"{reaction}-r{index}"
            precursor_uuid = f"{reaction}-p{index}"
            precursor = f"{reaction}-P{index}"
            uuid2smiles[reaction_uuid] = reaction
            uuid2smiles[precursor_uuid] = precursor
            node_dict[reaction] = {"id": reaction, "smiles": reaction, "type": "reaction"}
            node_dict[precursor] = {"id": precursor, "smiles": precursor, "type": "chemical"}
            graph.extend([
                {"source": "T", "target": reaction},
                {"source": reaction, "target": precursor},
            ])
            pathways.append([
                {"source": "target", "target": reaction_uuid},
                {"source": reaction_uuid, "target": precursor_uuid},
            ])
            pathways_properties.append({"score": -index})
        return {
            "uds": {
                "uuid2smiles": uuid2smiles,
                "node_dict": node_dict,
                "graph": graph,
                "pathways": pathways,
                "pathways_properties": pathways_properties,
            },
            "stats": {"total_paths": len(pathways)},
        }

    primary = make_result(["A>>T", "A>>T", "A>>T"])
    repair = make_result(["B>>T", "C>>T"])

    merged = TreeSearchResultsController.merge_tree_builder_result_candidates(
        primary,
        repair,
        repair_metadata={"banned_first_step_reaction": "A>>T"},
    )
    compacted = TreeSearchResultsController.compact_tree_builder_result_for_storage(merged)

    review = compacted["route_quality_review"]
    assert review["needs_repair"] is False
    assert review["unique_first_step_families"] == 3
    assert compacted["route_quality_repair"]["attempted"] is True
    assert compacted["route_quality_repair"]["banned_first_step_reaction"] == "A>>T"


def test_compact_tree_builder_result_drops_unsolved_search_tree():
    result_doc = {
        "stats": {"total_chemicals": 50000, "total_reactions": 70000},
        "uds": {
            "uuid2smiles": {"target-u": "CCO"},
            "node_dict": {
                "CCO": {"id": "CCO", "smiles": "CCO", "type": "chemical"},
                **{
                    f"CC{i}": {
                        "id": f"CC{i}",
                        "smiles": f"CC{i}",
                        "type": "chemical",
                        "payload": "x" * 100,
                    }
                    for i in range(20)
                },
            },
            "graph": [{"source": "CCO", "target": f"CC{i}"} for i in range(20)],
            "pathways": [],
            "pathways_properties": [],
        },
    }

    compacted = TreeSearchResultsController.compact_tree_builder_result_for_storage(
        result_doc
    )

    assert compacted["stats"]["total_paths"] == 0
    assert compacted["uds"] is None
    assert compacted["storage"]["reason"] == "unsolved_tree_without_paths"
    assert compacted["storage"]["frontier_summary"]["frontier_leaf_count"] == 20


def test_compact_unsolved_tree_preserves_root_reactions_for_recursive_resume():
    result_doc = {
        "stats": {"total_paths": 0},
        "uds": {
            "uuid2smiles": {},
            "node_dict": {
                "target": {
                    "id": "target-u",
                    "smiles": "COC",
                    "type": "chemical",
                    "depth": 0,
                },
                "reaction": {
                    "id": "reaction-u",
                    "smiles": "CBr.CO>>COC",
                    "type": "reaction",
                    "rxn_score_from_model": 0.42,
                    "plausibility": 0.91,
                },
                "bromide": {
                    "id": "bromide-u",
                    "smiles": "CBr",
                    "type": "chemical",
                    "purchase_price": 0,
                },
                "methanol": {
                    "id": "methanol-u",
                    "smiles": "CO",
                    "type": "chemical",
                    "purchase_price": 1.0,
                },
            },
            "graph": [
                {"source": "target-u", "target": "reaction-u"},
                {"source": "reaction-u", "target": "bromide-u"},
                {"source": "reaction-u", "target": "methanol-u"},
            ],
            "pathways": [],
            "pathways_properties": [],
        },
    }

    compacted = TreeSearchResultsController.compact_tree_builder_result_for_storage(
        result_doc
    )

    root_reactions = compacted["storage"]["frontier_summary"]["root_reactions"]
    assert root_reactions == [
        {
            "id": "reaction-u",
            "smiles": "CBr.CO>>COC",
            "type": "reaction",
            "rxn_score_from_model": 0.42,
            "plausibility": 0.91,
            "score": 0.42,
            "product_smiles": "COC",
            "precursors": ["CBr", "CO"],
        }
    ]


def test_compact_unsolved_tree_prioritizes_stock_then_small_frontier_leaves():
    result_doc = {
        "stats": {"total_paths": 0},
        "uds": {
            "uuid2smiles": {},
            "node_dict": {
                "target": {"id": "target", "smiles": "CCCCO", "type": "chemical"},
                "large": {"id": "large", "smiles": "CCCCCCCC", "type": "chemical"},
                "small": {"id": "small", "smiles": "CC", "type": "chemical"},
                "stock": {
                    "id": "stock",
                    "smiles": "CCC",
                    "type": "chemical",
                    "purchase_price": 1.0,
                },
            },
            "graph": [
                {"source": "target", "target": "large"},
                {"source": "target", "target": "small"},
                {"source": "target", "target": "stock"},
            ],
            "pathways": [],
            "pathways_properties": [],
        },
    }

    compacted = TreeSearchResultsController.compact_tree_builder_result_for_storage(
        result_doc
    )

    leaves = compacted["storage"]["frontier_summary"]["top_frontier_leaves"]
    assert [leaf["smiles"] for leaf in leaves] == ["CCC", "CC", "CCCCCCCC"]


def test_standardize_tree_builder_result_handles_missing_prices_after_compaction():
    result_doc = {
        "uds": {
            "uuid2smiles": {
                "target-u": "CCO",
                "rxn-u": "CCO>>CC",
                "precursor-u": "CC",
            },
            "node_dict": {
                "CCO": {"id": "CCO", "smiles": "CCO", "type": "chemical"},
                "CCO>>CC": {
                    "id": "CCO>>CC",
                    "smiles": "CCO>>CC",
                    "type": "reaction",
                    "rxn_score_from_model": 0.7,
                    "plausibility": 0.8,
                },
                "CC": {"id": "CC", "smiles": "CC", "type": "chemical"},
            },
            "graph": [
                {"source": "CCO", "target": "CCO>>CC"},
                {"source": "CCO>>CC", "target": "CC"},
            ],
            "pathways": [
                [
                    {"source": "target-u", "target": "rxn-u"},
                    {"source": "rxn-u", "target": "precursor-u"},
                ]
            ],
            "pathways_properties": [{}],
        },
    }

    standardized = standardize_result_tb(result_doc)

    assert standardized["uds"]["pathways_properties"][0]["precursor_cost"] is None
    assert standardized["uds"]["pathways_properties"][0]["num_reactions"] == 1


def test_collect_live_celery_task_ids_handles_active_reserved_and_scheduled():
    task_ids = TreeSearchResultsController._collect_live_celery_task_ids(
        {"worker-a": [{"id": "active-1"}]},
        {"worker-a": [{"id": "reserved-1"}]},
        {"worker-a": [{"request": {"id": "scheduled-1"}}]},
        None,
    )

    assert task_ids == {"active-1", "reserved-1", "scheduled-1"}


def test_started_task_default_grace_supports_long_route_searches():
    assert tree_search_results_module.STALE_STARTED_GRACE_SECONDS >= 6 * 60 * 60
    assert tree_search_results_module.STALE_STARTED_PENDING_GRACE_SECONDS <= 15 * 60
    assert tree_search_results_module.STALE_PENDING_GRACE_SECONDS <= 30 * 60


class FakeResultsCollection:
    def __init__(self, docs):
        self.docs = docs
        self.updates = []

    def _matches(self, doc, query):
        for key, value in query.items():
            if key == "$or":
                if not any(self._matches(doc, item) for item in value):
                    return False
                continue
            if isinstance(doc.get(key), list):
                if value not in doc.get(key, []):
                    return False
            elif doc.get(key) != value:
                return False
        return True

    def find(self, query, projection):
        states = set(query["result_state"]["$in"])
        return [
            {
                key: doc[key]
                for key in ["result_id", "task_id", "modified", "result_state"]
                if key in doc
            }
            for doc in self.docs
            if doc.get("user") == query["user"]
            and doc.get("result_type") == query["result_type"]
            and doc.get("result_state") in states
        ]

    def aggregate(self, pipeline):
        docs = list(self.docs)
        for stage in pipeline:
            if "$match" in stage:
                docs = [doc for doc in docs if self._matches(doc, stage["$match"])]
            elif "$unset" in stage:
                fields = set(stage["$unset"])
                docs = [
                    {key: value for key, value in doc.items() if key not in fields}
                    for doc in docs
                ]
            elif "$sort" in stage:
                sort_keys = list(stage["$sort"].keys())
                docs = sorted(
                    docs,
                    key=lambda doc: tuple(doc.get(key) for key in sort_keys),
                    reverse=True,
                )
        return docs

    def find_one(self, query):
        for doc in self.docs:
            if self._matches(doc, query):
                return dict(doc)
        return None

    def update_one(self, query, update):
        self.updates.append((query, update))


def _controller_with_docs(docs):
    controller = object.__new__(TreeSearchResultsController)
    controller.collection = FakeResultsCollection(docs)
    return controller


class FakeUser:
    def __init__(self, username):
        self.username = username


class FakeUserController:
    def __init__(self, username):
        self.username = username

    def get_current_user(self, token):
        return FakeUser(self.username)


class FakeRegistry:
    def __init__(self, username):
        self.username = username

    def get_util(self, module):
        assert module == "user_controller"
        return FakeUserController(self.username)


def test_record_unclosed_result_failure_sets_failed_state_and_preserves_stats(monkeypatch):
    controller = _controller_with_docs([
        {
            "user": "guest",
            "result_type": "tree_builder",
            "result_state": "started",
            "result_id": "result-1",
        }
    ])
    monkeypatch.setattr(
        tree_search_results_module,
        "get_util_registry",
        lambda: FakeRegistry("guest"),
    )

    controller.record_unclosed_result_failure(
        result_id="result-1",
        result={
            "status": "SUCCESS",
            "stats": {"total_paths": 0, "total_chemicals": 42},
            "uds": {"uuid2smiles": {}, "node_dict": {}, "graph": [], "pathways": []},
        },
        error="No closed route after expanded search.",
        token="token",
    )

    update = controller.collection.updates[0][1]["$set"]
    assert update["result_state"] == "failed"
    assert update["num_trees"] == 0
    assert update["result"]["status"] == "FAILED"
    assert update["result"]["error"] == "No closed route after expanded search."
    assert update["result"]["stats"]["total_chemicals"] == 42


def test_public_results_are_visible_without_explicit_shared_with(monkeypatch):
    now = datetime.now()
    controller = _controller_with_docs([
        {
            "user": "askcos_admin",
            "result_id": "public-result",
            "description": "public route",
            "created": now,
            "modified": now,
            "result_state": "completed",
            "result_type": "tree_builder",
            "public": True,
            "shared_with": [],
            "num_trees": 10,
        },
        {
            "user": "other",
            "result_id": "private-result",
            "description": "private route",
            "created": now,
            "modified": now,
            "result_state": "completed",
            "result_type": "tree_builder",
            "public": False,
            "shared_with": [],
        },
    ])
    monkeypatch.setattr(
        tree_search_results_module,
        "get_util_registry",
        lambda: FakeRegistry("guest_current"),
    )

    results = controller.list(token="token")

    assert [item.result_id for item in results] == ["public-result"]


def test_public_result_can_be_retrieved_without_explicit_shared_with(monkeypatch):
    now = datetime.now()
    controller = _controller_with_docs([
        {
            "_id": "mongo-id",
            "user": "askcos_admin",
            "result_id": "public-result",
            "description": "public route",
            "created": now,
            "modified": now,
            "result_state": "failed",
            "result_type": "tree_builder",
            "public": True,
            "shared_with": [],
            "result": {"error": "no route"},
        },
    ])
    monkeypatch.setattr(
        tree_search_results_module,
        "get_util_registry",
        lambda: FakeRegistry("guest_current"),
    )

    result = controller.retrieve(result_id="public-result", token="token")

    assert result.result_id == "public-result"
    assert result.public is True


def test_reconcile_closes_stale_pending_task_missing_from_celery(monkeypatch):
    class LostPendingTask:
        state = tree_search_results_module.states.PENDING
        result = None

    controller = _controller_with_docs([
        {
            "user": "guest",
            "result_type": "tree_builder",
            "result_state": "pending",
            "result_id": "result-1",
            "task_id": "lost-task",
            "modified": datetime.now() - timedelta(minutes=5),
        }
    ])
    monkeypatch.setattr(
        TreeSearchResultsController,
        "_get_live_celery_task_ids",
        staticmethod(lambda: set()),
    )
    monkeypatch.setattr(
        tree_search_results_module.celery_app,
        "AsyncResult",
        lambda task_id: LostPendingTask(),
    )
    monkeypatch.setattr(
        tree_search_results_module,
        "STALE_PENDING_GRACE_SECONDS",
        60,
    )

    controller.reconcile_incomplete_results_for_user("guest")

    assert controller.collection.updates
    update = controller.collection.updates[0][1]["$set"]
    assert update["result_state"] == "failed"
    assert "no longer active" in update["result"]["error"]


def test_reconcile_closes_started_task_that_regressed_to_pending(monkeypatch):
    class LostPendingTask:
        state = tree_search_results_module.states.PENDING
        result = None

    controller = _controller_with_docs([
        {
            "user": "guest",
            "result_type": "tree_builder",
            "result_state": "started",
            "result_id": "result-1",
            "task_id": "lost-started-task",
            "modified": datetime.now() - timedelta(minutes=10),
        }
    ])
    monkeypatch.setattr(
        TreeSearchResultsController,
        "_get_live_celery_task_ids",
        staticmethod(lambda: set()),
    )
    monkeypatch.setattr(
        tree_search_results_module.celery_app,
        "AsyncResult",
        lambda task_id: LostPendingTask(),
    )
    monkeypatch.setattr(
        tree_search_results_module,
        "STALE_STARTED_PENDING_GRACE_SECONDS",
        60,
    )

    controller.reconcile_incomplete_results_for_user("guest")

    assert controller.collection.updates
    update = controller.collection.updates[0][1]["$set"]
    assert update["result_state"] == "failed"
    assert "no longer active" in update["result"]["error"]


def test_reconcile_closes_stale_incomplete_result_without_task_id(monkeypatch):
    controller = _controller_with_docs([
        {
            "user": "guest",
            "result_type": "tree_builder",
            "result_state": "started",
            "result_id": "result-1",
            "modified": datetime.now() - timedelta(minutes=5),
        }
    ])
    monkeypatch.setattr(
        TreeSearchResultsController,
        "_get_live_celery_task_ids",
        staticmethod(lambda: set()),
    )
    monkeypatch.setattr(
        tree_search_results_module,
        "STALE_STARTED_PENDING_GRACE_SECONDS",
        60,
    )

    controller.reconcile_incomplete_results_for_user("guest")

    assert controller.collection.updates
    update = controller.collection.updates[0][1]["$set"]
    assert update["result_state"] == "failed"
    assert "missing Celery task id" in update["result"]["error"]
