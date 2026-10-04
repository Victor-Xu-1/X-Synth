"""CSV/validation fixtures are protocol data, never scientific acceptance evidence."""

import csv
import hashlib
from io import StringIO

import pytest
from pydantic import ValidationError

from packages.adapters.optimization.contracts import OptimizationRequest
from packages.adapters.optimization.prepare import prepare_experiment
from packages.adapters.optimization.tables import export_recommendations, inspect_table

CSV = "temperature,solvent,response\n10,a,1\n20,a,2\n10,b,3\n20,b,4\n"


def request_body(content=CSV, **updates):
    return {
        "content": content,
        "table_sha256": hashlib.sha256(content.encode()).hexdigest(),
        "selected_rows": [1, 2, 3],
        "factors": [
            {"name": "temperature", "kind": "numerical", "values": [10, 20]},
            {"name": "solvent", "kind": "categorical", "values": ["a", "b", "c"]},
        ],
        "target": {
            "name": "response",
            "kind": "response",
            "unit": "",
            "direction": "maximize",
        },
        "batch_size": 1,
        "seed": 42,
        "confirmed_measurements": True,
        "confirmed_candidates": True,
        **updates,
    }


def test_real_csv_parser_handles_bom_quotes_and_embedded_commas_without_selecting_records():
    table = inspect_table(
        '\ufefftemperature,solvent,response\r\n10,"label, with comma",1\r\n20,b,2\r\n'
    )
    assert table.row_count == 2
    assert table.rows[0].values["solvent"] == "label, with comma"
    assert [column.numeric for column in table.columns] == [True, False, True]
    assert not hasattr(table, "selected_rows")


@pytest.mark.parametrize(
    "content",
    [
        "",
        "a,a\n1,2",
        "a,b\n1,2,3",
        "a,b\n1",
        "a,b\n",
        "a,b\n\n",
        'a,b\n1,"unfinished',
        "a,b\n1,\x00",
        " a,b\n1,2",
        "a\t,b\n1,2",
        'a,b\n1,"two\nlines"',
        "a,b\n1," + "x" * 161,
        "a,b\n" + "1,2\n" * 4097,
        "a,b\n1," + "中" * (1024 * 1024),
    ],
)
def test_invalid_or_oversized_table_never_returns_a_partial_import(content):
    with pytest.raises(ValueError):
        inspect_table(content)


@pytest.mark.parametrize(
    "updates",
    [
        {"confirmed_measurements": False},
        {"confirmed_candidates": False},
        {"confirmed_measurements": 1},
        {"selected_rows": [1, 2]},
        {"selected_rows": [1, 2, 2]},
        {"selected_rows": [True, 2, 3]},
        {"batch_size": 9},
        {"batch_size": "1"},
        {"seed": -1},
        {"model_path": "/etc/passwd"},
        {"target": {"name": "response", "direction": "minimize"}},
        {"target": {"name": "response", "unit": "fraction"}},
        {"factors": [{"name": "temperature", "kind": "numerical", "values": [10, 10]}]},
        {
            "factors": [
                {
                    "name": "temperature",
                    "kind": "numerical",
                    "values": [10, 10.000000001],
                }
            ]
        },
        {
            "factors": [
                {"name": "temperature", "kind": "numerical", "values": [True, 20]}
            ]
        },
        {
            "factors": [
                {
                    "name": "temperature",
                    "kind": "numerical",
                    "values": [float("nan"), 20],
                }
            ]
        },
        {
            "factors": [
                {"name": "temperature", "kind": "numerical", "values": ["10", "20"]}
            ]
        },
        {
            "factors": [
                {"name": "response", "kind": "categorical", "values": ["a", "b"]}
            ]
        },
        {
            "factors": [
                {"name": "solvent", "kind": "categorical", "values": ["a", " a"]}
            ]
        },
    ],
)
def test_closed_typed_request_rejects_coercion_unconfirmed_or_unsafe_configuration(
    updates,
):
    with pytest.raises(ValidationError):
        OptimizationRequest.model_validate(request_body(**updates))


def test_candidate_cardinality_is_checked_before_cartesian_construction():
    factors = [
        {
            "name": f"factor{i}",
            "kind": "categorical",
            "values": [str(n) for n in range(32)],
        }
        for i in range(3)
    ]
    with pytest.raises(ValidationError, match="4096"):
        OptimizationRequest.model_validate(request_body(factors=factors))


def test_only_explicitly_selected_actual_rows_are_used_not_unselected_response_values():
    prepared = prepare_experiment(OptimizationRequest.model_validate(request_body()))
    assert [row["response"] for row in prepared.measurements] == [1, 2, 3]
    assert prepared.best_observed == 3
    assert prepared.remaining == 3
    assert prepared.candidate_count == 6


def test_actual_replicates_remain_separate_measurements_but_count_once_in_search_space():
    content = CSV + "10,a,1.5\n"
    prepared = prepare_experiment(
        OptimizationRequest.model_validate(
            request_body(content, selected_rows=[1, 2, 3, 5])
        )
    )
    assert len(prepared.measurements) == 4
    assert len(prepared.measured_keys) == 3


@pytest.mark.parametrize(
    "updates,match",
    [
        ({"table_sha256": "a" * 64}, "变化"),
        ({"selected_rows": [1, 2, 5]}, "当前表"),
        (
            {"factors": [{"name": "missing", "kind": "numerical", "values": [10, 20]}]},
            "当前表",
        ),
        (
            {
                "factors": [
                    {"name": "temperature", "kind": "numerical", "values": [20, 30]}
                ]
            },
            "数值水平",
        ),
        ({"batch_size": 4}, "仅剩"),
    ],
)
def test_selection_space_or_freshness_mismatch_fails_closed(updates, match):
    with pytest.raises(ValueError, match=match):
        prepare_experiment(OptimizationRequest.model_validate(request_body(**updates)))


@pytest.mark.parametrize("value", ["", "NaN", "Inf", "101", "-1"])
def test_yield_requires_actual_finite_percentage(value):
    content = CSV.replace("10,a,1", f"10,a,{value}")
    with pytest.raises(ValueError):
        prepare_experiment(
            OptimizationRequest.model_validate(
                request_body(content, target={"name": "response"})
            )
        )


def test_minimization_keeps_observations_in_original_units():
    prepared = prepare_experiment(
        OptimizationRequest.model_validate(
            request_body(
                target={
                    "name": "response",
                    "kind": "response",
                    "unit": "mM",
                    "direction": "minimize",
                },
            )
        )
    )
    assert prepared.best_observed == 1
    assert prepared.measurements[2]["response"] == 3


def test_export_separates_empty_measured_target_from_posterior_and_neutralizes_formulas():
    from packages.adapters.optimization.contracts import NextExperiment

    row = NextExperiment(
        conditions={"temperature": -10, "solvent": "=external()"},
        posterior_mean=1,
        posterior_std=2,
    )
    content = export_recommendations(
        ["temperature", "solvent"], "response", [row], "a" * 64
    )
    restored = next(iter(csv.DictReader(StringIO(content))))
    assert restored["response"] == ""
    assert restored["empirically_confirmed"] == "false"
    assert restored["solvent"] == "'=external()"
    assert restored["temperature"] == "-10"
    assert restored["posterior_std"] == "2"


def test_downloaded_csv_can_be_reimported_but_posterior_columns_are_never_measurement_inputs():
    from packages.adapters.optimization.contracts import NextExperiment

    rows = [
        NextExperiment(
            conditions={"temperature": temperature, "solvent": "a"},
            posterior_mean=0,
            posterior_std=1,
        )
        for temperature in (10, 20, 30)
    ]
    content = export_recommendations(
        ["temperature", "solvent"], "response", rows, "a" * 64
    )
    preview = inspect_table(content)
    roles = {column.name: column.selectable for column in preview.columns}
    assert roles["response"] and roles["temperature"]
    assert not roles["posterior_mean"] and not roles["posterior_std"]
    assert not roles["empirically_confirmed"] and not roles["request_sha256"]
    assert preview.columns[3].missing_count == 3
    with pytest.raises(ValidationError):
        OptimizationRequest.model_validate(
            request_body(target={"name": "posterior_mean", "kind": "response"})
        )
