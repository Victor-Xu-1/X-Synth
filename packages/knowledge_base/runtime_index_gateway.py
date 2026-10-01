from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RuntimeIndex:
    engine: str
    kind: str
    path: str
    source: str | None = None

    @property
    def key(self) -> str:
        return f"{self.engine}:{self.kind}"


class RuntimeIndexGateway:
    def __init__(self, indexes: list[RuntimeIndex]) -> None:
        self._indexes = {index.key: index for index in indexes}

    def get(self, engine: str, kind: str) -> RuntimeIndex:
        key = f"{engine}:{kind}"
        try:
            return self._indexes[key]
        except KeyError as exc:
            raise KeyError(f"Runtime index not registered: {key}") from exc

    def list_for_engine(self, engine: str) -> list[RuntimeIndex]:
        return [index for index in self._indexes.values() if index.engine == engine]
