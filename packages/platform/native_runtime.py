"""One local supervisor for the configured native ASKCOS processes."""

from __future__ import annotations

import json
import os
import signal
import socket
import stat
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from .asset_identity import native_asset_identity
from .atomic_file import write_json
from .performance import PerformanceBudget
from .resource_metrics import process_sample


@dataclass(frozen=True)
class NativeService:
    directory: str
    module: str
    port: int
    python_asset: str | None = None
    required_asset: str | None = None
    environment: tuple[tuple[str, str], ...] = ()


SERVICES = {
    "template_relevance": NativeService(
        "retro/template_relevance", "template_relevance_server", 19410
    ),
    "fast_filter": NativeService("fast_filter", "fast_filter_server", 9611),
    "scscore": NativeService("scscore", "scscore_server", 9741),
    "pathway_ranker": NativeService("pathway_ranker", "pathway_ranker_server", 9681),
    "value_network": NativeService("value_network", "value_server", 9350),
    "cluster": NativeService("cluster", "cluster_reactions_server", 9801),
    "gateway": NativeService("askcos2_core", "app", 9100),
    "expand_one": NativeService("tree_search/expand_one", "expand_one_server", 9301),
    "mcts": NativeService("tree_search/mcts", "mcts_server", 9311),
    "retro_star": NativeService("tree_search/retro_star", "retro_star_server", 9321),
    "condition_recommender": NativeService(
        "context_recommender", "condition_server", 9901,
        python_asset="context-env/bin/python", required_asset="models/context/v1/asset.json",
        environment=(("TF_USE_LEGACY_KERAS", "1"), ("CUDA_VISIBLE_DEVICES", "-1")),
    ),
    "forward_predictor": NativeService(
        "forward_predictor/graph2smiles", "forward_server", 9911,
        required_asset="models/forward/USPTO_STEREO/asset.json",
        environment=(("CUDA_VISIBLE_DEVICES", "-1"),),
    ),
    "impurity": NativeService(
        "impurity_predictor", "native_server", 9941,
        python_asset="impurity-env/bin/python",
        required_asset="impurity-env/lib/python3.12/site-packages/rxnmapper/models/transformers/albert_heads_8_uspto_all_1310k/pytorch_model.bin",
        environment=(("CUDA_VISIBLE_DEVICES", "-1"), ("HF_HUB_OFFLINE", "1"), ("TRANSFORMERS_OFFLINE", "1")),
    ),
}


def read_private_environment(path: Path) -> dict[str, str]:
    metadata = path.lstat()
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_mode & 0o077
        or metadata.st_size > 65536
    ):
        raise ValueError(
            "Private runtime configuration must be a regular owner-only file"
        )
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not key.replace("_", "").isalnum():
            raise ValueError("Invalid private runtime configuration")
        values[key] = value
    return values


def ensure_port_available(port: int) -> None:
    with socket.socket() as probe:
        # Match Uvicorn: closed connections in TIME_WAIT are not live listeners.
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind(("127.0.0.1", port))


class NativeRuntime:
    def __init__(
        self,
        *,
        source: Path,
        python: Path,
        assets: Path,
        state: Path,
        credentials: Path,
        services: list[str],
        budget: PerformanceBudget,
    ):
        self.source, self.python, self.assets, self.state = (
            source.resolve(),
            python.absolute(),
            assets.resolve(),
            state.resolve(),
        )
        if not self.python.is_file() or not (self.source / "VERSION").is_file():
            raise ValueError(
                "A source checkout and installed native Python are required"
            )
        if (
            not services
            or len(services) != len(set(services))
            or any(name not in SERVICES for name in services)
        ):
            raise ValueError("Select supported native services exactly once")
        self.services, self.budget, self.processes, self.logs = services, budget, {}, []
        self.restarts = {name: 0 for name in services}
        self.stopping = False
        self.environment = {**os.environ, **read_private_environment(credentials)}
        self.environment.update(
            {
                "PYTHONPATH": str(self.source),
                "ASKCOS_DATA_DIR": str(self.assets),
                "X_SYNTH_STATE_DIR": str(self.state),
                "MODULE_CONFIG_PATH": "configs.module_config_x_synth",
                "MONGO_HOST": "127.0.0.1",
                "MONGO_PORT": self.environment.get("MONGO_PORT", "27018"),
                "MONGO_USER": self.environment.get("MONGO_INITDB_ROOT_USERNAME", ""),
                "MONGO_PW": self.environment.get("MONGO_INITDB_ROOT_PASSWORD", ""),
                "GATEWAY_URL": "http://127.0.0.1:9100",
                "ASKCOS_ENABLE_MCP": "0",
                "ASKCOS_MODEL_THREADS": str(budget.model_threads),
                "X_SYNTH_MODEL_THREADS": str(budget.model_threads),
                "X_SYNTH_MODEL_PARALLELISM": str(budget.model_parallelism),
                "OMP_NUM_THREADS": str(budget.model_threads),
                "MKL_NUM_THREADS": str(budget.model_threads),
                "OPENBLAS_NUM_THREADS": str(budget.model_threads),
                "TF_NUM_INTRAOP_THREADS": str(budget.model_threads),
                "TF_NUM_INTEROP_THREADS": "1",
                "PYTHONUNBUFFERED": "1",
            }
        )
        models = self.environment.get(
            "X_SYNTH_ASKCOS_MODELS", "pistachio,pistachio_ringbreaker"
        ).split(",")
        self.environment["ASKCOS_TEMPLATE_MODEL_DIRS"] = json.dumps(
            {
                name: str(self.assets / "models/template-relevance" / name)
                for name in models
            }
        )
        from packages.adapters.stock.stock_index import StockIndex

        stock = StockIndex(self.environment["X_SYNTH_STOCK_INDEX"])
        self.environment["X_SYNTH_ASSET_IDENTITY"] = native_asset_identity(
            self.source, self.assets, stock, models
        )

    def _service_available(self, name):
        service = SERVICES[name]
        python = self.assets / service.python_asset if service.python_asset else self.python
        return not service.required_asset or not (
            not python.is_file() or not (self.assets / service.required_asset).is_file()
        )

    def _service_environment(self, name):
        service = SERVICES[name]
        environment = self.environment
        if name in {"condition_recommender", "forward_predictor", "impurity"}:
            allowed = {
                "PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "PYTHONPATH",
                "ASKCOS_DATA_DIR", "X_SYNTH_MODEL_THREADS", "X_SYNTH_MODEL_PARALLELISM",
                "OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS",
                "TF_NUM_INTRAOP_THREADS", "TF_NUM_INTEROP_THREADS", "PYTHONUNBUFFERED",
                "X_SYNTH_FORWARD_URL", "X_SYNTH_FAST_FILTER_URL",
            }
            environment = {key: value for key, value in environment.items() if key in allowed}
            model_home = self.state / "native/model-home" / name
            if model_home.is_symlink() or not model_home.resolve().is_relative_to(self.state):
                raise ValueError("Scientific process HOME must remain inside private runtime state")
            model_home.mkdir(parents=True, mode=0o700, exist_ok=True)
            model_home.chmod(0o700)
            environment.update(
                HOME=str(model_home), HF_HOME=str(model_home / "huggingface"),
                XDG_CACHE_HOME=str(model_home / ".cache"), PYTHONNOUSERSITE="1",
            )
        return {**environment, **dict(service.environment), "HF_HUB_DISABLE_IMPLICIT_TOKEN": "1"}

    def _spawn(self, name, logs):
        service = SERVICES[name]
        python = self.assets / service.python_asset if service.python_asset else self.python
        if not self._service_available(name):
            print(json.dumps({"service": name, "status": "unavailable", "reason": "optional_assets_missing"}), flush=True)
            return
        log = (logs / f"{name}.log").open("ab", buffering=0)
        self.logs.append(log)
        command = [
            str(python),
            "-m",
            "uvicorn",
            f"{service.module}:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(service.port),
            "--workers",
            "1",
            "--no-access-log",
        ]
        process = subprocess.Popen(
            command,
            cwd=self.source / "apps/askcos-v2" / service.directory,
            env=self._service_environment(name),
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        self.processes[name] = process
        self._publish_processes()
        print(
            json.dumps({"service": name, "pid": process.pid, "port": service.port}),
            flush=True,
        )

    def _publish_processes(self):
        services = {}
        for name, process in self.processes.items():
            try:
                services[name] = {
                    "pid": process.pid,
                    "start_ticks": process_sample(process.pid)["start_ticks"],
                }
            except (OSError, ValueError, IndexError):
                continue
        write_json(self.state / "native/runtime.json", {"services": services})

    def run(self):
        logs = self.state / "logs/native"
        logs.mkdir(parents=True, exist_ok=True)
        # Refuse occupied ports before starting any process. Never kill another stack.
        for name in self.services:
            if self._service_available(name):
                ensure_port_available(SERVICES[name].port)
        try:
            for name in self.services:
                self._spawn(name, logs)
            while not self.stopping:
                failed = [
                    name
                    for name, process in self.processes.items()
                    if process.poll() is not None
                ]
                for name in failed:
                    if self.restarts[name] >= 3:
                        continue
                    self.restarts[name] += 1
                    print(
                        json.dumps(
                            {
                                "service": name,
                                "status": "restarting",
                                "attempt": self.restarts[name],
                            }
                        ),
                        flush=True,
                    )
                    time.sleep(2 ** self.restarts[name])
                    if self.stopping:
                        break
                    self._spawn(name, logs)
                time.sleep(1)
        finally:
            self.stop()

    def stop(self, *_):
        self.stopping = True
        # Persist search boundaries while their model and inventory dependencies live.
        search = [process for name, process in self.processes.items() if name in {"mcts", "retro_star"}]
        dependencies = [process for name, process in self.processes.items() if name not in {"mcts", "retro_star"}]
        for group, timeout in ((search, 30), (dependencies, 10)):
            for process in group:
                if process.poll() is None:
                    try:
                        os.killpg(process.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
            deadline = time.monotonic() + timeout
            for process in group:
                try:
                    process.wait(timeout=max(0.1, deadline - time.monotonic()))
                except subprocess.TimeoutExpired:
                    if process.poll() is None:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                    process.wait()
        for log in self.logs:
            log.close()
