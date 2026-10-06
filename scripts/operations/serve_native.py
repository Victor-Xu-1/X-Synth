from __future__ import annotations

import argparse
import signal
from pathlib import Path

from packages.platform.native_runtime import SERVICES, NativeRuntime
from packages.platform.performance import PerformanceBudget


def main():
    parser = argparse.ArgumentParser(
        description="Run the isolated, configured ASKCOS services"
    )
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--credentials", type=Path, required=True)
    parser.add_argument("--lease-fd", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--generation", help=argparse.SUPPRESS)
    parser.add_argument(
        "--services", nargs="+", choices=tuple(SERVICES), default=list(SERVICES)
    )
    args = parser.parse_args()
    if (args.lease_fd is None) != (args.generation is None):
        parser.error("Managed native startup requires both an inherited lease and generation")
    runtime = NativeRuntime(
        source=Path(__file__).resolve().parents[2],
        python=args.python,
        assets=args.assets,
        state=args.state,
        credentials=args.credentials,
        services=args.services,
        budget=PerformanceBudget.from_environment(),
        generation=args.generation,
        lease_fd=args.lease_fd,
    )
    signal.signal(signal.SIGTERM, runtime.request_stop)
    signal.signal(signal.SIGINT, runtime.request_stop)
    runtime.run()


if __name__ == "__main__":
    main()
