"""One local supervisor for the configured native ASKCOS processes."""

from __future__ import annotations

import json
import os
import socket
import stat
import subprocess
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path

from .asset_identity import native_asset_identity
from .atomic_file import write_json
from .performance import PerformanceBudget
from .native_endpoints import ENDPOINTS, SEARCH_KEY_VARIABLE, endpoint_environment, require_search_key, resolve_native_endpoints
from .native_runtime_ownership import NativeLease, OwnedProcessGroup, cleanup_native_runtime, read_runtime_manifest, stop_owned_groups
from .resource_metrics import IDENTITY_FIELDS, process_identity
from .runtime_logging import NativeLogPump


LAUNCH_GATE = """
import os, sys
descriptor = int(sys.argv[1])
try:
    authorized = os.read(descriptor, 1) == b"1"
finally:
    os.close(descriptor)
if not authorized:
    sys.exit(125)
os.execv(sys.argv[2], sys.argv[2:])
"""


@dataclass(frozen=True)
class NativeService:
    directory: str
    module: str
    python_asset: str | None = None
    required_asset: str | None = None
    environment: tuple[tuple[str, str], ...] = ()

    @property
    def port(self):
        name = next(name for name, service in SERVICES.items() if service is self)
        return resolve_native_endpoints()[name].port


SERVICES = {
    "template_relevance": NativeService(
        "retro/template_relevance", "template_relevance_server"
    ),
    "fast_filter": NativeService("fast_filter", "fast_filter_server"),
    "scscore": NativeService("scscore", "scscore_server"),
    "pathway_ranker": NativeService("pathway_ranker", "pathway_ranker_server"),
    "value_network": NativeService("value_network", "value_server"),
    "cluster": NativeService("cluster", "cluster_reactions_server"),
    "gateway": NativeService("askcos2_core", "app"),
    "expand_one": NativeService("tree_search/expand_one", "expand_one_server"),
    "mcts": NativeService("tree_search/mcts", "mcts_server"),
    "retro_star": NativeService("tree_search/retro_star", "retro_star_server"),
    "condition_recommender": NativeService(
        "context_recommender", "condition_server",
        python_asset="context-env/bin/python", required_asset="models/context/v1/asset.json",
        environment=(("TF_USE_LEGACY_KERAS", "1"), ("CUDA_VISIBLE_DEVICES", "-1")),
    ),
    "forward_predictor": NativeService(
        "forward_predictor/graph2smiles", "forward_server",
        required_asset="models/forward/USPTO_STEREO/asset.json",
        environment=(("CUDA_VISIBLE_DEVICES", "-1"),),
    ),
    "impurity": NativeService(
        "impurity_predictor", "native_server",
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


def ensure_port_available(port: int, host: str = "127.0.0.1") -> None:
    with socket.socket() as probe:
        # Match Uvicorn: closed connections in TIME_WAIT are not live listeners.
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind((host, port))


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
        generation: str | None = None,
        lease_fd: int | None = None,
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
        self.services, self.budget = list(services), budget
        self.credentials, self.lease_fd = credentials, lease_fd
        self.generation = generation or uuid.uuid4().hex
        self.processes, self.groups, self.logs = {}, {}, {}
        self.service_generations, self.service_status = {}, {}
        self.revision, self.phase, self._published = 0, "starting", None
        self.supervisor = None
        self.restarts = {name: 0 for name in services}
        self.stopping = False
        self._stop_requested = threading.Event()
        self.environment = dict(os.environ)

    def _configure_environment(self):
        private = read_private_environment(self.credentials)
        private_endpoints = {key: value for key, value in private.items()
                             if key in {spec.variable for spec in ENDPOINTS.values()} | {"GATEWAY_URL"}}
        combined = {**self.environment, **private}
        self.endpoints = resolve_native_endpoints(combined, managed=True)
        launch_endpoints = resolve_native_endpoints(self.environment, managed=True)
        if private_endpoints and self.endpoints != launch_endpoints:
            raise ValueError("Native endpoint overrides must be shared through the launcher environment")
        # The internal channel key belongs to the launcher, never a credential file.
        combined.pop(SEARCH_KEY_VARIABLE, None)
        if self.environment.get(SEARCH_KEY_VARIABLE):
            combined[SEARCH_KEY_VARIABLE] = self.environment[SEARCH_KEY_VARIABLE]
        self.environment = combined
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
                "ASKCOS_ENABLE_MCP": "0",
                "ASKCOS_MODEL_THREADS": str(self.budget.model_threads),
                "X_SYNTH_MODEL_THREADS": str(self.budget.model_threads),
                "X_SYNTH_MODEL_PARALLELISM": str(self.budget.model_parallelism),
                "OMP_NUM_THREADS": str(self.budget.model_threads),
                "MKL_NUM_THREADS": str(self.budget.model_threads),
                "OPENBLAS_NUM_THREADS": str(self.budget.model_threads),
                "TF_NUM_INTRAOP_THREADS": str(self.budget.model_threads),
                "TF_NUM_INTEROP_THREADS": "1",
                "PYTHONUNBUFFERED": "1",
            }
        )
        self.environment.update(endpoint_environment(self.endpoints))
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
            self.source, self.assets, stock, models,
            reaction_library=Path(self.environment["X_SYNTH_REACTION_LIBRARY_DB"])
            if self.environment.get("X_SYNTH_REACTION_LIBRARY_DB") else None,
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
        self._cleanup_service(name)
        service = SERVICES[name]
        endpoint = self.endpoints[name]
        python = self.assets / service.python_asset if service.python_asset else self.python
        self.service_generations[name] = uuid.uuid4().hex
        self.service_status[name] = "starting"
        self._publish_processes()
        if not self._service_available(name):
            self.service_status[name] = "unavailable"
            self._publish_processes()
            print(json.dumps({"service": name, "status": "unavailable", "reason": "optional_assets_missing"}), flush=True)
            return
        command = [
            str(python),
            "-m",
            "uvicorn",
            f"{service.module}:app",
            "--host",
            endpoint.host,
            "--port",
            str(endpoint.port),
            "--workers",
            "1",
            "--no-access-log",
        ]
        read_fd, write_fd = os.pipe()
        try:
            process = subprocess.Popen(
                [str(python), "-c", LAUNCH_GATE, str(read_fd), *command],
                cwd=self.source / "apps/askcos-v2" / service.directory,
                env=self._service_environment(name),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                pass_fds=(read_fd,),
            )
            os.close(read_fd)
            read_fd = None
            self.processes[name] = process
            try:
                self.groups[name] = OwnedProcessGroup.capture(process)
            except BaseException:
                # An unreaped direct Popen child cannot have its PID reused.
                process.kill()
                process.wait(timeout=2)
                process.stdout.close()
                del self.processes[name]
                raise
            self._publish_processes()
            self.logs[name] = NativeLogPump(
                logs / f"{name}.log", process.stdout,
                secret=self.environment.get(SEARCH_KEY_VARIABLE, ""),
            )
            # Publish durable ownership before importing Uvicorn or allocating models.
            os.write(write_fd, b"1")
        except BaseException:
            self._cleanup_service(name)
            self.service_status[name] = "failed"
            self._publish_processes()
            raise
        finally:
            if read_fd is not None:
                os.close(read_fd)
            os.close(write_fd)
        self.service_status[name] = "running"
        self._publish_processes()
        print(
            json.dumps({"service": name, "pid": process.pid, "port": endpoint.port}),
            flush=True,
        )

    def _publish_processes(self):
        if self.supervisor is None:
            return
        if self._published is not None:
            current = read_runtime_manifest(self.state)
            if current and current.get("generation") != self.generation:
                raise RuntimeError("Native runtime generation changed; refusing foreign publication")
        services = {}
        for name in self.services:
            descriptor = {}
            if name in self.groups:
                self.groups[name].refresh()
                descriptor = self.groups[name].descriptor()
            services[name] = {**descriptor, "generation": self.service_generations.get(name),
                              "status": self.service_status.get(name, "starting")}
        document = {
            "schema_version": 1, "generation": self.generation, "status": self.phase,
            "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
            "supervisor": {key: self.supervisor[key] for key in IDENTITY_FIELDS},
            "services": services,
        }
        if document != self._published:
            self.revision += 1
            write_json(self.state / "native/runtime.json", {**document, "revision": self.revision})
            self._published = document

    def _cleanup_service(self, name):
        if name not in self.processes:
            return
        self.service_status[name] = "stopping"
        publication_error = None
        try:
            self._publish_processes()
        except Exception as error:
            publication_error = error
        stop_owned_groups([self.groups[name]], timeout=30 if name in {"mcts", "retro_star"} else 10)
        self.processes[name].wait(timeout=2)
        if name in self.logs:
            self.logs[name].close()
            del self.logs[name]
        elif self.processes[name].stdout:
            self.processes[name].stdout.close()
        del self.processes[name], self.groups[name]
        if publication_error:
            raise RuntimeError("Native cleanup could not publish its lifecycle") from publication_error

    def _restart_failed(self, logs):
        for name, process in list(self.processes.items()):
            # Observe the session before poll reaps a crashed leader's identity.
            self.groups[name].refresh()
            if self.logs[name].error is not None:
                raise RuntimeError("Native service logging failed") from self.logs[name].error
            if process.poll() is None:
                continue
            self._cleanup_service(name)
            if self.restarts[name] >= 3:
                self.service_status[name] = "failed"
                self._publish_processes()
                continue
            self.restarts[name] += 1
            self.service_status[name] = "restarting"
            self._publish_processes()
            print(json.dumps({"service": name, "status": "restarting", "attempt": self.restarts[name]}), flush=True)
            if self._stop_requested.wait(2 ** self.restarts[name]):
                return
            self._spawn(name, logs)

    def request_stop(self, *_):
        self.stopping = True
        self._stop_requested.set()

    def run(self):
        lease = NativeLease(self.state, inherited_fd=self.lease_fd)
        try:
            require_search_key(self.environment, self.services)
            cleanup_native_runtime(self.state)
            self.supervisor = process_identity(os.getpid())
            self._publish_processes()
            self.endpoints = resolve_native_endpoints(self.environment, managed=True)
            # Refuse occupied ports before starting any process. Never kill another stack.
            for name in self.services:
                if self._service_available(name):
                    ensure_port_available(self.endpoints[name].port, self.endpoints[name].host)
            self._configure_environment()
            logs = self.state / "logs/native"
            logs.mkdir(parents=True, exist_ok=True, mode=0o700)
            for name in self.services:
                if self.stopping:
                    return
                self._spawn(name, logs)
            self.phase = "running"
            self._publish_processes()
            while not self.stopping:
                self._restart_failed(logs)
                self._publish_processes()
                self._stop_requested.wait(1)
        finally:
            try:
                self.stop()
            finally:
                lease.close()

    def stop(self, *_):
        if self.phase == "stopped":
            return
        self.request_stop()
        self.phase = "stopping"
        errors = []
        try:
            self._publish_processes()
        except Exception as error:
            errors.append(error)
        # Persist search boundaries while their model and inventory dependencies live.
        search = [group for name, group in self.groups.items() if name in {"mcts", "retro_star"}]
        dependencies = [group for name, group in self.groups.items() if name not in {"mcts", "retro_star"}]
        for group, timeout in ((search, 30), (dependencies, 10)):
            try:
                stop_owned_groups(group, timeout=timeout)
            except Exception as error:
                errors.append(error)
        for name, process in self.processes.items():
            try:
                process.wait(timeout=2)
                if name in self.logs:
                    self.logs[name].close()
                self.service_status[name] = "stopped"
            except Exception as error:
                errors.append(error)
        self.phase = "failed" if errors else "stopped"
        try:
            self._publish_processes()
        except Exception as error:
            errors.append(error)
        if errors:
            raise RuntimeError("Native runtime cleanup failed") from errors[0]
