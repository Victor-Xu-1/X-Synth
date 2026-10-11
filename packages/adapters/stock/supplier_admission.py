"""Preserve negative catalog facts through every supported import path."""

CATALOG_ROLES = {"", "catalog", "supplier_catalog", "commercial_catalog", "route_closure", "procurement"}
UNAVAILABLE_STATES = {
    "discontinued", "withdrawn", "unavailable", "not_available", "not_for_sale",
    "deleted", "rejected", "ambiguous", "unverified",
    "停售", "已停售", "停产", "已停产", "停止供应", "不可采购", "不可购买",
    "不再供应", "无法供应", "待确认", "未核实",
}
AVAILABILITY_FIELDS = (
    "availability", "availability_status", "status", "stock", "stock_status",
    "inventory", "lead_time", "库存", "库存状态", "现货", "交期",
)


def _value(value):
    return str(value or "").strip().casefold().replace("-", "_").replace(" ", "_")


def _true(value):
    return value is True or type(value) is int and value == 1 or _value(value) in {"true", "yes", "1"}


def _false(value):
    return value is False or type(value) is int and value == 0 or _value(value) in {"false", "no", "0"}


def _fields(fact):
    values = {}
    for key, value in fact.items():
        if not isinstance(key, str):
            return None
        name = key.strip().casefold().replace("-", "_").replace(" ", "_")
        values.setdefault(name, []).append(value)
    return values


def admitted_catalog_facts(row: dict) -> bool:
    if not isinstance(row, dict):
        return False
    root = _fields(row)
    if root is None:
        return False
    facts = [root]
    for properties in root.get("properties", []):
        if properties is None:
            continue
        if not isinstance(properties, list) or any(not isinstance(item, dict) for item in properties):
            return False
        facts.extend(_fields(item) for item in properties)
    for fact in facts:
        if fact is None or fact is not root and "properties" in fact:
            return False
        if any(_value(value) != "accepted" for value in fact.get("decision", [])):
            return False
        for role in fact.get("evidence_role", []):
            if (role is not None and not isinstance(role, str)) or _value(role) not in CATALOG_ROLES:
                return False
        for key in ("test_data", "is_test", "demo_data", "is_demo"):
            for value in fact.get(key, []):
                if value not in (None, "") and not _false(value):
                    return False
        for key in ("buyable", "purchasable"):
            for value in fact.get(key, []):
                if value not in (None, "") and not _true(value):
                    return False
        for key in AVAILABILITY_FIELDS:
            for value in fact.get(key, []):
                if value is not None and type(value) not in {str, int, float, bool}:
                    return False
                if _value(value) in UNAVAILABLE_STATES:
                    return False
    # Backorder and missing live stock do not negate catalog purchasability.
    return True
