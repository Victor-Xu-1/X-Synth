from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "compose.yaml"


def service_blocks(compose_text: str) -> dict[str, str]:
    blocks: dict[str, list[str]] = {}
    current: str | None = None

    for line in compose_text.splitlines():
        if line.startswith("volumes:"):
            break
        if line.startswith("  ") and not line.startswith("    ") and line.rstrip().endswith(":"):
            current = line.strip()[:-1]
            blocks[current] = [line]
            continue
        if current:
            blocks[current].append(line)

    return {name: "\n".join(lines) for name, lines in blocks.items()}


def test_compose_services_have_explicit_healthchecks() -> None:
    blocks = service_blocks(COMPOSE.read_text(encoding="utf-8"))

    missing = [name for name, block in sorted(blocks.items()) if "healthcheck:" not in block]

    assert missing == []
