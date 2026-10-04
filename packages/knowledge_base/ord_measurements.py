"""Map source-recorded ORD conditions and product yields without inference."""

from __future__ import annotations

import json
import math

from .ord_reader import OrdRecordError
from .reaction_models import EvidenceYield, RecordedConditions, RecordedInput, RecordedParameter


def enum_name(message, field: str) -> str:
    descriptor = message.DESCRIPTOR.fields_by_name[field].enum_type
    value = getattr(message, field)
    item = descriptor.values_by_number.get(value)
    if item is None:
        raise OrdRecordError("unknown_recorded_enum")
    return item.name


def _message_dict(message) -> dict:
    from google.protobuf.json_format import MessageToDict

    return MessageToDict(message, preserving_proto_field_name=True)


def _json(value: dict) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _parameter(quantity, field: str, *, context: dict | None = None) -> RecordedParameter | None:
    if not quantity.HasField("value"):
        return None
    if not math.isfinite(quantity.value):
        raise OrdRecordError("nonfinite_recorded_parameter", field)
    details = dict(context or {})
    return RecordedParameter(
        value=float(quantity.value), unit=enum_name(quantity, "units"),
        precision=float(quantity.precision) if quantity.HasField("precision") else None,
        source_field=field, details=_json(details) if details else None,
    )


def _conditions_parameters(block, field: str, quantity_name: str) -> list[RecordedParameter]:
    values = []
    setpoint = _parameter(
        block.setpoint, f"{field}.setpoint", context={"control": _message_dict(block.control)},
    )
    if setpoint is not None:
        values.append(setpoint)
    for index, measurement in enumerate(block.measurements):
        context = {
            "measurement_type": enum_name(measurement, "type"),
            "details": measurement.details,
            "time": _message_dict(measurement.time),
        }
        parameter = _parameter(
            getattr(measurement, quantity_name),
            f"{field}.measurements[{index}].{quantity_name}", context=context,
        )
        if parameter is not None:
            values.append(parameter)
    return values


def recorded_conditions(reaction, structures, outcome_indices: list[int]) -> RecordedConditions | None:
    conditions = RecordedConditions(
        temperature=_conditions_parameters(reaction.conditions.temperature, "conditions.temperature", "temperature"),
        pressure=_conditions_parameters(reaction.conditions.pressure, "conditions.pressure", "pressure"),
    )
    for key in sorted(reaction.inputs):
        reaction_input = reaction.inputs[key]
        prefix = f"inputs[{json.dumps(key, ensure_ascii=True)}]"
        for time_field in ("addition_time", "addition_duration"):
            value = _parameter(getattr(reaction_input, time_field), f"{prefix}.{time_field}")
            if value is not None:
                conditions.time.append(value)
        temperature = _parameter(reaction_input.addition_temperature, f"{prefix}.addition_temperature")
        if temperature is not None:
            conditions.temperature.append(temperature)
        for index, compound in enumerate(reaction_input.components):
            field = f"{prefix}.components[{index}]"
            amount_kind = compound.amount.WhichOneof("kind")
            amounts = []
            if amount_kind in ("mass", "moles", "volume"):
                amount = _parameter(
                    getattr(compound.amount, amount_kind), f"{field}.amount.{amount_kind}",
                    context={"volume_includes_solutes": compound.amount.volume_includes_solutes}
                    if compound.amount.HasField("volume_includes_solutes") else None,
                )
                if amount is not None:
                    amounts.append(amount)
            names = [item.value for item in compound.identifiers if enum_name(item, "type") == "NAME" and item.value.strip()]
            if not names:
                names = [
                    f"{enum_name(item, 'type')}: {item.value}"
                    for item in compound.identifiers
                    if item.value.strip() and enum_name(item, "type") not in ("SMILES", "CXSMILES", "INCHI", "MOLBLOCK")
                ]
            if not names and structures.input_smiles[key, index] is None:
                raise OrdRecordError("empty_recorded_input_identity", field)
            conditions.inputs.append(RecordedInput(
                role=enum_name(compound, "reaction_role"), name="; ".join(names) or None,
                smiles=structures.input_smiles[key, index], amounts=amounts, source_field=field,
            ))
    for index in outcome_indices:
        value = _parameter(reaction.outcomes[index].reaction_time, f"outcomes[{index}].reaction_time")
        if value is not None:
            conditions.time.append(value)
    return conditions if any(conditions.model_dump().values()) else None


def _analysis(outcome, measurement) -> str | None:
    if not measurement.analysis_key:
        return None
    data = {"key": measurement.analysis_key, "analysis_record_present": measurement.analysis_key in outcome.analyses}
    if data["analysis_record_present"]:
        analysis = outcome.analyses[measurement.analysis_key]
        data.update(type=enum_name(analysis, "type"), details=analysis.details)
        if analysis.HasField("is_of_isolated_species"):
            data["is_of_isolated_species"] = analysis.is_of_isolated_species
    # Raw spectra/data URLs are not link authorities and are not copied here.
    return _json(data)


def recorded_yields(reaction, outcome_structures) -> list[EvidenceYield]:
    yields = []
    for structures in outcome_structures:
        outcome = reaction.outcomes[structures.index]
        for index, smiles in structures.product_by_index.items():
            product = outcome.products[index]
            for measurement_index, measurement in enumerate(product.measurements):
                if enum_name(measurement, "type") != "YIELD":
                    continue
                kind = measurement.WhichOneof("value")
                value, unit = None, None
                if kind in ("percentage", "float_value"):
                    quantity = getattr(measurement, kind)
                    if quantity.HasField("value"):
                        value = float(quantity.value)
                        if not math.isfinite(value):
                            raise OrdRecordError("nonfinite_recorded_yield")
                    if kind == "percentage":
                        unit = "%"
                # A text-only or mass-based yield remains source text. Do not
                # parse a number, convert a peak area, or invent a percentage.
                fields = ("type", "details", "analysis_key", "uses_internal_standard", "is_normalized", "uses_authentic_standard")
                data = _message_dict(measurement)
                text = {key: data[key] for key in fields if key in data}
                if kind:
                    text[kind] = data[kind]
                yields.append(EvidenceYield(
                    value=value, unit=unit, method="ord_product_measurement", text=_json(text),
                    product_smiles=smiles, analysis=_analysis(outcome, measurement),
                    measurement_type=enum_name(measurement, "type"),
                    source_field=f"outcomes[{structures.index}].products[{index}].measurements[{measurement_index}]",
                ))
    return yields


def representation_gaps(reaction) -> list[tuple[str, str]]:
    """Expose qualitative fields the shared numeric model cannot represent."""
    gaps = []
    for name in ("temperature", "pressure"):
        block = getattr(reaction.conditions, name)
        if block.control.ListFields() and not block.setpoint.HasField("value"):
            gaps.append((f"qualitative_{name}_control", f"conditions.{name}.control"))
    for key in sorted(reaction.inputs):
        for index, compound in enumerate(reaction.inputs[key].components):
            if compound.amount.WhichOneof("kind") == "unmeasured":
                field = f"inputs[{json.dumps(key, ensure_ascii=True)}].components[{index}].amount.unmeasured"
                gaps.append(("unmeasured_input_amount", field))
    return gaps
