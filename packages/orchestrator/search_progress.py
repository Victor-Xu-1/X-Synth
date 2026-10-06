"""Round-scoped progress; completed search artifacts remain the source of truth."""


def begin_search_round(checkpoint: dict, pass_number: int) -> dict:
    previous = checkpoint.get("pass_number", 1)
    if pass_number < previous:
        raise ValueError("Search progress cannot move to an earlier round")
    return {
        **checkpoint,
        "pass_number": pass_number,
        "native_progress": checkpoint.get("native_progress", {})
        if pass_number == previous else {},
    }
