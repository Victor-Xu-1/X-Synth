"""Process-scoped Linux/WSL leadership, released automatically after a crash."""

import fcntl
from pathlib import Path


class LeaderLock:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.stream = path.open("a+b")
        self.acquired = False

    def acquire(self) -> bool:
        try:
            fcntl.flock(self.stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        self.acquired = True
        return True

    def close(self):
        if self.acquired:
            fcntl.flock(self.stream.fileno(), fcntl.LOCK_UN)
            self.acquired = False
        self.stream.close()
