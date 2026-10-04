"""Fixed stdin/stdout protocol in the isolated operator-selected Python runtime."""

import json
import logging
import sys

from pydantic import ValidationError

from .contracts import MAX_CSV_BYTES, OptimizationRequest, RuntimeHealth

LOGGER = logging.getLogger(__name__)


def main() -> int:
    try:
        from .baybe_engine import recommend, runtime_versions

        if sys.argv[1:] == ["--health"]:
            # Verify the actual science imports, not just installed distribution metadata.
            from baybe import Campaign  # noqa: F401
            from baybe.recommenders import BotorchRecommender  # noqa: F401

            output = RuntimeHealth(
                ready=True, reason="BayBE 运行环境已就绪。", versions=runtime_versions()
            )
        elif not sys.argv[1:]:
            payload = sys.stdin.buffer.read(MAX_CSV_BYTES * 4 + 1)
            if len(payload) > MAX_CSV_BYTES * 4:
                raise ValueError("请求超过优化工作区上限。")
            output = recommend(OptimizationRequest.model_validate_json(payload))
        else:
            raise ValueError("Unsupported worker invocation.")
        print(output.model_dump_json())
        return 0
    except (ValueError, ValidationError):
        print(json.dumps({"error": "invalid_input"}))
        return 2
    except Exception as exc:  # noqa: BLE001 - redact exceptions at the process boundary
        # Never place CSV contents, process paths or untrusted exception text in a response.
        LOGGER.error("BayBE worker failed: %s", type(exc).__name__)
        print(json.dumps({"error": "runtime_failure"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
