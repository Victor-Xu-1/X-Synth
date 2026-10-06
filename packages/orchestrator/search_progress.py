"""Round-scoped progress; completed search artifacts remain the source of truth."""


def remaining_search_rounds(checkpoint: dict, repair_attempts: int) -> range:
    """Resume the current round without retrying failures from earlier rounds."""
    current = checkpoint.get("pass_number", 1)
    final = repair_attempts + 1
    if type(current) is not int or not 1 <= current <= final:
        raise ValueError("Persisted search round exceeds the original repair budget")
    return range(current, final + 1)


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
