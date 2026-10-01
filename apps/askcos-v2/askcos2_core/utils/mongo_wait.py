import time

from pymongo import errors


def wait_for_mongodb(
    client,
    timeout_seconds: float = 60,
    interval_seconds: float = 1,
):
    deadline = time.monotonic() + timeout_seconds
    last_error = None

    while time.monotonic() <= deadline:
        try:
            return client.server_info()
        except (errors.ServerSelectionTimeoutError, errors.ConnectionFailure) as exc:
            last_error = exc
            time.sleep(interval_seconds)

    raise ValueError("Cannot connect to mongodb to load banlists") from last_error
