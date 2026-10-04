"""UTF-8 comma-separated measurement tables; no paths, formulas or partial imports."""

import csv
import hashlib
import math
from io import StringIO

from .contracts import (
    MAX_COLUMNS,
    MAX_CSV_BYTES,
    MAX_LEVELS,
    MAX_TABLE_ROWS,
    RESERVED_COLUMNS,
    TableColumn,
    TablePreview,
    TableRow,
    clean_header,
)


def finite_number(value: str) -> float:
    try:
        number = float(value)
    except (ValueError, OverflowError) as exc:
        raise ValueError("实测响应与数值因子必须是完整有限数值。") from exc
    if not math.isfinite(number) or abs(number) > 1e12:
        raise ValueError("数值非有限或超过支持范围。")
    return number


def inspect_table(content: str) -> TablePreview:
    if len(content.encode("utf-8")) > MAX_CSV_BYTES:
        raise ValueError("CSV 超过 2 MiB，不能截断导入。")
    if "\x00" in content:
        raise ValueError("CSV 不能包含 NUL 字符。")
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    reader = csv.reader(
        StringIO(content.removeprefix("\ufeff"), newline=""), strict=True
    )
    try:
        names = next(reader)
        if not 2 <= len(names) <= MAX_COLUMNS:
            raise ValueError("CSV 必须包含 2-24 列。")
        for name in names:
            if not 1 <= len(name) <= 64:
                raise ValueError("列名长度必须为 1-64。")
            clean_header(name)
        if len(set(names)) != len(names):
            raise ValueError("CSV 列名重复。")
        rows = []
        for index, fields in enumerate(reader, 1):
            if index > MAX_TABLE_ROWS:
                raise ValueError("CSV 超过 4096 条记录，不能截断导入。")
            if len(fields) != len(names):
                raise ValueError(f"CSV 第 {index} 条记录的列数不一致。")
            values = [value.strip() for value in fields]
            if any(
                len(value) > 160 or any(ord(c) < 32 for c in value) for value in values
            ):
                raise ValueError(f"CSV 第 {index} 条记录含过长字段或控制字符。")
            rows.append(TableRow(index=index, values=dict(zip(names, values))))
    except (csv.Error, StopIteration) as exc:
        raise ValueError("CSV 格式不完整，请选择带表头的 UTF-8 逗号分隔表。") from exc
    if not rows:
        raise ValueError("CSV 没有实验记录。")
    columns = []
    for name in names:
        values = list(
            dict.fromkeys(row.values[name] for row in rows if row.values[name])
        )
        numeric = bool(values)
        try:
            for value in values:
                finite_number(value)
        except ValueError:
            numeric = False
        columns.append(
            TableColumn(
                name=name,
                numeric=numeric,
                selectable=name not in RESERVED_COLUMNS,
                unique_count=len(values),
                values=values[:MAX_LEVELS],
                missing_count=sum(not row.values[name] for row in rows),
            )
        )
    return TablePreview(
        table_sha256=digest, columns=columns, rows=rows, row_count=len(rows)
    )


def safe_csv_cell(value):
    # Quote handling alone does not prevent spreadsheet formula execution.
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def export_recommendations(names, target_name, recommendations, request_sha256) -> str:
    stream = StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(
        [
            safe_csv_cell(name)
            for name in [
                "recommendation",
                *names,
                target_name,
                "posterior_mean",
                "posterior_std",
                "empirically_confirmed",
                "request_sha256",
            ]
        ]
    )
    for index, recommendation in enumerate(recommendations, 1):
        writer.writerow(
            [
                index,
                *(safe_csv_cell(recommendation.conditions[name]) for name in names),
                "",
                recommendation.posterior_mean,
                recommendation.posterior_std,
                "false",
                request_sha256,
            ]
        )
    return stream.getvalue()
