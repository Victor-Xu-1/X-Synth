"""Recorded process minima, retaining outcome and parameter field identity."""

import re

YIELD_FIELD = re.compile(r"outcomes\[(\d+)\]\.products\[\d+\]\.measurements\[\d+\]")
TIME_FIELD = re.compile(r"outcomes\[(\d+)\]\.reaction_time")


def condition_field_scope(field, outcome):
    if field == "procedure" or field.startswith(("conditions.temperature.", "conditions.pressure.")):
        return True
    matched = TIME_FIELD.fullmatch(field)
    return bool(matched and int(matched[1]) == outcome)


def _condition_fields(record, outcome):
    fields = []
    if record.conditions:
        for parameter in record.conditions.temperature:
            if parameter.source_field.startswith("conditions.temperature.") and parameter.unit in {"CELSIUS", "KELVIN", "FAHRENHEIT"}:
                fields.append(parameter.source_field)
        for parameter in record.conditions.pressure:
            if parameter.source_field.startswith("conditions.pressure.") and parameter.value >= 0 and parameter.unit in {
                "BAR", "ATMOSPHERE", "PSI", "KPSI", "PASCAL", "KILOPASCAL", "TORR", "MM_HG",
            }:
                fields.append(parameter.source_field)
        for parameter in record.conditions.time:
            matched = TIME_FIELD.fullmatch(parameter.source_field)
            if matched and int(matched[1]) == outcome and parameter.value > 0 and parameter.unit in {"SECOND", "MINUTE", "HOUR", "DAY"}:
                fields.append(parameter.source_field)
    if record.procedure and record.procedure.strip():
        fields.append("procedure")
    return sorted(set(fields))


def process_observations(record, product):
    """Addition timestamps and another outcome's duration are not reaction conditions."""
    observations = []
    for measured in record.reported_yields:
        if (measured.method != "ord_product_measurement" or measured.measurement_type != "YIELD"
                or measured.unit != "%" or measured.value is None or not 0 < measured.value <= 100
                or measured.product_smiles != product or not measured.source_field):
            continue
        matched = YIELD_FIELD.fullmatch(measured.source_field)
        if not matched or (record.provenance.outcome_indices and int(matched[1]) not in record.provenance.outcome_indices):
            continue
        outcome = int(matched[1])
        conditions = _condition_fields(record, outcome)
        if conditions:
            observations.append({"outcome_index": outcome, "product_smiles": product,
                                 "yield_value": measured.value, "yield_unit": measured.unit,
                                 "yield_source_field": measured.source_field,
                                 "condition_source_fields": conditions})
    return observations


def process_fields(record):
    """Source-only field projections for receipt binding, never inferred conditions."""
    outcomes = set(record.provenance.outcome_indices)
    outcomes.update(int(matched[1]) for item in record.reported_yields if item.source_field
                    and (matched := YIELD_FIELD.fullmatch(item.source_field)))
    return {"reaction_condition_fields": sorted(set(
                field for outcome in outcomes for field in _condition_fields(record, outcome))),
            "reaction_yield_measurements": [item.model_dump(mode="json", include={
                "value", "unit", "method", "measurement_type", "product_smiles", "source_field"
            }) for item in record.reported_yields]}
