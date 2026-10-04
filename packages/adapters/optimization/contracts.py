"""Closed product contracts, not arbitrary BayBE configuration or serialized models."""

from itertools import pairwise
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictFloat,
    StrictInt,
    StrictStr,
    field_validator,
    model_validator,
)

MAX_CSV_BYTES = 2 * 1024 * 1024
MAX_TABLE_ROWS = 4096
MAX_COLUMNS = 24
MAX_MEASUREMENTS = 256
MAX_FACTORS = 8
MAX_LEVELS = 32
MAX_CANDIDATES = 4096
MAX_ENCODED_DIMENSIONS = 96
MAX_BATCH = 8
BAYBE_VERSION = "0.15.0"
BAYBE_SOURCE = "https://github.com/emdgroup/baybe/tree/0.15.0"
BAYBE_PAPER = "https://doi.org/10.1039/D5DD00050E"
RESERVED_COLUMNS = {
    "BatchNr",
    "FitNr",
    "recommendation",
    "posterior_mean",
    "posterior_std",
    "empirically_confirmed",
    "request_sha256",
}


def clean_header(value: str) -> str:
    if value != value.strip() or any(ord(c) < 32 for c in value):
        raise ValueError("列名不能包含首尾空格或控制字符。")
    return value


def clean_name(value: str) -> str:
    clean_header(value)
    if value in RESERVED_COLUMNS:
        raise ValueError("列名与计算或导出字段冲突，请重命名。")
    return value


def clean_label(value: str) -> str:
    if not value.strip() or value != value.strip() or any(ord(c) < 32 for c in value):
        raise ValueError("分类水平不能为空或包含控制字符、首尾空格。")
    return value


ColumnName = Annotated[
    StrictStr, Field(min_length=1, max_length=64), AfterValidator(clean_name)
]
TableHeader = Annotated[
    StrictStr, Field(min_length=1, max_length=64), AfterValidator(clean_header)
]
Label = Annotated[
    StrictStr, Field(min_length=1, max_length=160), AfterValidator(clean_label)
]
Number = Annotated[
    StrictFloat | StrictInt, Field(allow_inf_nan=False, ge=-1e12, le=1e12)
]
Scalar = Number | Label
Digest = Annotated[StrictStr, Field(pattern=r"^[a-f0-9]{64}$")]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TableInput(Contract):
    content: str = Field(min_length=1, max_length=MAX_CSV_BYTES)


class NumericalFactor(Contract):
    name: ColumnName
    kind: Literal["numerical"]
    values: list[Number] = Field(min_length=2, max_length=MAX_LEVELS)

    @field_validator("values")
    @classmethod
    def unique_levels(cls, values):
        if len(set(values)) != len(values):
            raise ValueError("数值水平不能重复。")
        ordered = sorted(values)
        if any(b - a < 1e-8 * max(1, abs(a), abs(b)) for a, b in pairwise(ordered)):
            raise ValueError("数值水平过于接近，不能可靠区分。")
        return values


class CategoricalFactor(Contract):
    name: ColumnName
    kind: Literal["categorical"]
    values: list[Label] = Field(min_length=2, max_length=MAX_LEVELS)

    @field_validator("values")
    @classmethod
    def unique_levels(cls, values):
        if len(set(values)) != len(values):
            raise ValueError("分类水平不能重复。")
        return values


Factor = Annotated[NumericalFactor | CategoricalFactor, Field(discriminator="kind")]


class Target(Contract):
    name: ColumnName
    kind: Literal["yield_percent", "response"] = "yield_percent"
    direction: Literal["maximize", "minimize"] = "maximize"
    unit: str = Field(default="%", max_length=32)

    @model_validator(mode="after")
    def valid_yield(self):
        if any(ord(c) < 32 for c in self.unit):
            raise ValueError("单位不能包含控制字符。")
        if self.kind == "yield_percent" and (
            self.direction != "maximize" or self.unit != "%"
        ):
            raise ValueError("收率目标使用百分数并最大化；其他响应请明确选择响应目标。")
        return self


class OptimizationRequest(TableInput):
    table_sha256: Digest
    selected_rows: list[Annotated[StrictInt, Field(ge=1, le=MAX_TABLE_ROWS)]] = Field(
        min_length=3, max_length=MAX_MEASUREMENTS
    )
    factors: list[Factor] = Field(min_length=1, max_length=MAX_FACTORS)
    target: Target
    batch_size: Annotated[StrictInt, Field(ge=1, le=MAX_BATCH)] = 3
    seed: Annotated[StrictInt, Field(ge=0, le=2**32 - 1)] = 42
    confirmed_measurements: StrictBool
    confirmed_candidates: StrictBool

    @field_validator("confirmed_measurements", "confirmed_candidates")
    @classmethod
    def explicit_confirmation(cls, value):
        if value is not True:
            raise ValueError("请确认当前实测表与候选条件。")
        return value

    @model_validator(mode="after")
    def bounded_space(self):
        names = [factor.name for factor in self.factors]
        if len(set(names)) != len(names) or self.target.name in names:
            raise ValueError("因子列必须互异，且不能与目标列相同。")
        if len(set(self.selected_rows)) != len(self.selected_rows):
            raise ValueError("实测行不能重复选择。重复实验应分别保留实际记录行。")
        size = 1
        dimensions = 0
        for factor in self.factors:
            size *= len(factor.values)
            dimensions += len(factor.values) if factor.kind == "categorical" else 1
        if size > MAX_CANDIDATES or dimensions > MAX_ENCODED_DIMENSIONS:
            raise ValueError("候选组合超过 4096 或编码维数超过 96，请缩小离散水平。")
        return self


class TableColumn(Contract):
    name: TableHeader
    numeric: bool
    selectable: bool = True
    unique_count: int
    values: list[str] = Field(max_length=MAX_LEVELS)
    missing_count: int


class TableRow(Contract):
    index: int
    values: dict[str, str]


class TablePreview(Contract):
    table_sha256: Digest
    columns: list[TableColumn]
    rows: list[TableRow]
    row_count: int


class RuntimeHealth(Contract):
    ready: bool
    reason: str
    busy: bool = False
    checking: bool = False
    versions: dict[str, str] = Field(default_factory=dict)
    engine: Literal["BayBE"] = "BayBE"
    expected_version: Literal["0.15.0"] = BAYBE_VERSION
    max_measurements: int = MAX_MEASUREMENTS
    max_candidates: int = MAX_CANDIDATES
    max_batch: int = MAX_BATCH


class NextExperiment(Contract):
    conditions: dict[str, Scalar]
    posterior_mean: Number
    posterior_std: Annotated[Number, Field(ge=0)]


class OptimizationResult(Contract):
    record_id: Annotated[StrictStr, Field(pattern=r"^[a-f0-9]{32}$")] | None = None
    request_sha256: Digest
    table_sha256: Digest
    engine: Literal["BayBE"] = "BayBE"
    versions: dict[str, str]
    source: Literal["https://github.com/emdgroup/baybe/tree/0.15.0"] = BAYBE_SOURCE
    paper: Literal["https://doi.org/10.1039/D5DD00050E"] = BAYBE_PAPER
    surrogate: Literal["GaussianProcessSurrogate"] = "GaussianProcessSurrogate"
    acquisition: Literal["qLogExpectedImprovement"] = "qLogExpectedImprovement"
    categorical_encoding: Literal["OHE"] = "OHE"
    uncertainty: Literal["latent_gp_posterior_standard_deviation"] = (
        "latent_gp_posterior_standard_deviation"
    )
    empirically_confirmed: Literal[False] = False
    seed: int
    selected_rows: list[int]
    measurement_count: int
    unique_measured_conditions: int
    candidate_count: int
    remaining_before_batch: int
    best_observed: Number
    target: Target
    recommendations: list[NextExperiment] = Field(min_length=1, max_length=MAX_BATCH)
    warnings: list[str]
    csv_content: str
