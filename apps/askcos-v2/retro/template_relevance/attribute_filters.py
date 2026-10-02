import math
import operator


OPERATORS = {
    "==": operator.eq, "!=": operator.ne, ">": operator.gt,
    ">=": operator.ge, "<": operator.lt, "<=": operator.le,
}


def filter_indices(attributes, filters):
    """Apply typed comparisons; caller-supplied expressions are never evaluated."""
    mask = attributes.index.to_series().map(lambda _: True)
    for item in filters:
        name, logic, value = item.get("name"), item.get("logic"), item.get("value")
        if name not in attributes.columns or logic not in OPERATORS:
            raise ValueError("Unknown template attribute or comparison operator")
        if not isinstance(value, (str, int, float, bool)):
            raise ValueError("Template attribute comparisons require scalar values")
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("Template attribute values must be finite")
        mask &= OPERATORS[logic](attributes[name], value).fillna(False)
    return attributes.index[mask].values
