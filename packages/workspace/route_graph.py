"""Validated document graph in forward synthesis direction."""

from __future__ import annotations

import hashlib
import json
from typing import Literal

import networkx as nx
from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, model_validator

from .source_evidence import SourceCandidate
from .structure_validation import MAX_SMILES_LENGTH, canonical_structure
from packages.chemistry.material_scope import material_scope_exclusion


MAX_REACTION_INPUT_OCCURRENCES = 499


class Position(BaseModel):
    model_config = ConfigDict(
        extra="forbid", allow_inf_nan=False, revalidate_instances="always"
    )
    x: float = Field(default=0, ge=-100000, le=100000)
    y: float = Field(default=0, ge=-100000, le=100000)


class RouteNode(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    type: Literal["molecule", "reaction"]
    smiles: str = Field(default="", max_length=MAX_SMILES_LENGTH)
    label: str = Field(default="", max_length=120)
    note: str = Field(default="", max_length=4096)
    position: Position = Field(default_factory=Position)

    @model_validator(mode="after")
    def validate_structure(self, info: ValidationInfo):
        if self.type == "molecule":
            self.smiles, _ = canonical_structure(
                self.smiles, max_atoms=(info.context or {}).get("max_structure_atoms")
            )
            if (
                not (info.context or {}).get("allow_archival_scope")
                and material_scope_exclusion(self.smiles)
            ):
                raise ValueError("该分子超出当前普通研究路线文档范围。")
        elif self.smiles:
            raise ValueError("反应节点不接受分子 SMILES")
        return self


class RouteEdge(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,128}$")
    source: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    target: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    input_occurrences: int = Field(
        default=1,
        strict=True,
        ge=1,
        le=MAX_REACTION_INPUT_OCCURRENCES,
        exclude_if=lambda count: type(count) is int and count == 1,
        description="Input record occurrences, not measured equivalents or stoichiometry",
    )


class RouteGraph(BaseModel):
    model_config = ConfigDict(extra="forbid", revalidate_instances="always")
    nodes: list[RouteNode] = Field(min_length=1, max_length=500)
    edges: list[RouteEdge] = Field(default_factory=list, max_length=2000)
    target_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")

    @model_validator(mode="before")
    @classmethod
    def bound_input(cls, value):
        if isinstance(value, dict):
            for name, limit in (("nodes", 500), ("edges", 2000)):
                items = value.get(name)
                if isinstance(items, list) and len(items) > limit:
                    raise ValueError(f"Route {name} exceed the graph budget")
        return value

    @model_validator(mode="after")
    def validate_graph(self):
        nodes = {node.id: node for node in self.nodes}
        if len(nodes) != len(self.nodes):
            raise ValueError("节点 ID 重复")
        if self.target_id not in nodes or nodes[self.target_id].type != "molecule":
            raise ValueError("目标节点必须是有效分子")
        ids, connections = set(), set()
        input_totals = {}
        graph = nx.DiGraph()
        graph.add_nodes_from(nodes)
        for edge in self.edges:
            if edge.source not in nodes or edge.target not in nodes:
                raise ValueError("连接引用了不存在的节点")
            if edge.id in ids or (edge.source, edge.target) in connections:
                raise ValueError("连接重复")
            if nodes[edge.source].type == nodes[edge.target].type:
                raise ValueError("连接必须位于分子与反应节点之间")
            if nodes[edge.source].type == "reaction":
                if edge.input_occurrences != 1:
                    raise ValueError("产物连接不能标注重复输入")
            else:
                total = input_totals.get(edge.target, 0) + edge.input_occurrences
                if total > MAX_REACTION_INPUT_OCCURRENCES:
                    raise ValueError("反应输入出现次数超出上限")
                input_totals[edge.target] = total
            ids.add(edge.id)
            connections.add((edge.source, edge.target))
            graph.add_edge(edge.source, edge.target)
        if not nx.is_directed_acyclic_graph(graph):
            raise ValueError("路线连接不能形成循环")
        if graph.out_degree(self.target_id):
            raise ValueError("目标节点不能继续连接下游反应")
        for node in self.nodes:
            if node.type == "reaction" and graph.out_degree(node.id) > 1:
                raise ValueError("一个反应节点只能连接一个产物")
            if node.type == "molecule" and graph.in_degree(node.id) > 1:
                raise ValueError("一个分子节点不能同时来自多个反应")
        return self

    def semantic_signature(self) -> str:
        chemistry = {
            "nodes": sorted((node.id, node.type, node.smiles) for node in self.nodes),
            # Default-one edges retain the exact legacy signature representation.
            "edges": sorted(
                (edge.source, edge.target, edge.input_occurrences)
                if edge.input_occurrences > 1
                else (edge.source, edge.target)
                for edge in self.edges
            ),
            "target": self.target_id,
        }
        return hashlib.sha256(
            json.dumps(chemistry, sort_keys=True).encode()
        ).hexdigest()


def graph_from_candidate(
    candidate: dict, *, max_atoms: int | None = None
) -> tuple[RouteGraph, dict]:
    candidate = SourceCandidate.model_validate(candidate)
    nodes, edges, scores = {}, [], {}

    def molecule(smiles):
        parsed = RouteNode.model_validate(
            {"id": "temporary", "type": "molecule", "smiles": smiles},
            context={"max_structure_atoms": max_atoms},
        )
        identifier = "m-" + hashlib.sha256(parsed.smiles.encode()).hexdigest()[:24]
        nodes[identifier] = parsed.model_copy(update={"id": identifier})
        return identifier

    target_id = molecule(candidate.target_smiles)
    for index, step in enumerate(candidate.steps):
        identifier = f"r-{index + 1}"
        nodes[identifier] = RouteNode(
            id=identifier, type="reaction", label=f"反应 {index + 1}"
        )
        product = molecule(step.product)
        edges.append(RouteEdge(id=f"e-{len(edges)}", source=identifier, target=product))
        inputs = {}
        for precursor in step.precursors:
            precursor_id = molecule(precursor)
            if precursor_id in inputs:
                inputs[precursor_id].input_occurrences += 1
                continue
            edge = RouteEdge(
                id=f"e-{len(edges)}", source=precursor_id, target=identifier
            )
            inputs[precursor_id] = edge
            edges.append(edge)
            if len(nodes) > 500 or len(edges) > 2000:
                raise ValueError("Source route exceeds the graph budget")
        score = step.confidence
        if (
            isinstance(score, (int, float))
            and not isinstance(score, bool)
            and 0 <= score <= 1
        ):
            scores[identifier] = float(score)
    graph = RouteGraph.model_validate(
        {"nodes": list(nodes.values()), "edges": edges, "target_id": target_id},
        context={"max_structure_atoms": max_atoms},
    )
    connections = nx.DiGraph((edge.source, edge.target) for edge in graph.edges)
    connections.add_nodes_from(nodes)
    if nx.ancestors(connections, target_id) | {target_id} != set(nodes):
        raise ValueError("Source route contains synthesis disconnected from its target")
    source = {
        "engine": candidate.engine,
        "route_id": candidate.route_id,
        "signature": graph.semantic_signature(),
        "prediction_scores": scores,
        "closed": candidate.closed,
    }
    return graph, source
