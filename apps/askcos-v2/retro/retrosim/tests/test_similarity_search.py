from reaction_record import get_reaction_smarts


def test_get_reaction_smarts_returns_empty_for_records_without_template():
    assert get_reaction_smarts({"reaction_id": "USPTO-1"}) == ""


def test_get_reaction_smarts_uses_reaction_smarts_when_present():
    assert get_reaction_smarts({"reaction_smarts": "[C:1]>>[C:1]"}) == "[C:1]>>[C:1]"
