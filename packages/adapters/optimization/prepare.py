"""Validate measured rows against the exact chemist-approved discrete search space."""

import hashlib
import math
from dataclasses import dataclass

from .contracts import OptimizationRequest
from .tables import finite_number, inspect_table


@dataclass(frozen=True)
class PreparedExperiment:
    measurements: list[dict]
    measured_keys: frozenset[tuple]
    candidate_count: int
    remaining: int
    best_observed: float
    request_sha256: str


def request_digest(request: OptimizationRequest) -> str:
    return hashlib.sha256(request.model_dump_json().encode("utf-8")).hexdigest()


def prepare_experiment(request: OptimizationRequest) -> PreparedExperiment:
    table = inspect_table(request.content)
    if table.table_sha256 != request.table_sha256:
        raise ValueError("实测表已变化，请重新选择并确认当前记录。")
    names = [factor.name for factor in request.factors]
    columns = {column.name for column in table.columns}
    if not {*names, request.target.name}.issubset(columns):
        raise ValueError("选择的因子或目标列不在当前表中。")
    if any(index > table.row_count for index in request.selected_rows):
        raise ValueError("选择的实测行不在当前表中。")
    measurements = []
    keys = set()
    for index in request.selected_rows:
        source = table.rows[index - 1].values
        record = {}
        for factor in request.factors:
            value = source[factor.name]
            if factor.kind == "numerical":
                value = finite_number(value)
                # Exact matching prevents silently rounding an experimental condition.
                matches = [level for level in factor.values if value == level]
                if not matches:
                    raise ValueError(
                        f"第 {index} 行的 {factor.name} 不在已确认的数值水平中。"
                    )
                value = float(matches[0])
            elif value not in factor.values:
                raise ValueError(
                    f"第 {index} 行的 {factor.name} 不在已确认的分类水平中。"
                )
            record[factor.name] = value
        observed = finite_number(source[request.target.name])
        if request.target.kind == "yield_percent" and not 0 <= observed <= 100:
            raise ValueError(f"第 {index} 行的收率必须是 0-100 的百分数。")
        record[request.target.name] = observed
        measurements.append(record)
        keys.add(tuple(record[name] for name in names))
    if len(keys) < 3:
        raise ValueError("真实贝叶斯拟合至少需要 3 组不同条件的实测记录。")
    observed = [row[request.target.name] for row in measurements]
    if max(observed) - min(observed) <= 1e-10:
        raise ValueError("已选择的响应没有可分辨变化，请检查实测数据。")
    candidate_count = math.prod(len(factor.values) for factor in request.factors)
    remaining = candidate_count - len(keys)
    if remaining < request.batch_size:
        raise ValueError(f"仅剩 {remaining} 组未测条件，少于请求的下一批实验数。")
    best = min(observed) if request.target.direction == "minimize" else max(observed)
    return PreparedExperiment(
        measurements,
        frozenset(keys),
        candidate_count,
        remaining,
        best,
        request_digest(request),
    )
