"""Single model process, bounded IPC, memory, deadline and explicit cleanup."""

import json
import multiprocessing
import resource
import time
from pathlib import Path
from threading import BoundedSemaphore

from native_mapper import configured_model_threads, load_models
from native_session import predict_impurities

from packages.adapters.askcos.impurities import (
    REQUEST_TIMEOUT,
    ImpurityInput,
    canonical_input,
)
from packages.adapters.askcos.native_models import NativeModelError

MAX_RESPONSE_BYTES = 250000
WORKER_ADDRESS_BYTES = 4 * 1024**3
WORKER_RSS_BYTES = 2 * 1024**3


def _worker(connection):
    try:
        resource.setrlimit(
            resource.RLIMIT_AS, (WORKER_ADDRESS_BYTES, WORKER_ADDRESS_BYTES)
        )
        models = load_models()
        connection.send_bytes(
            json.dumps({"ready": models[3].model_dump(mode="json")}).encode()
        )
        while True:
            raw = connection.recv_bytes(524288)
            try:
                body = canonical_input(ImpurityInput.model_validate_json(raw))
                output = predict_impurities(body, models)
                encoded = json.dumps({"result": output}, allow_nan=False).encode()
                if len(encoded) > MAX_RESPONSE_BYTES:
                    raise NativeModelError(
                        "杂质证据超过响应限制，请减少输入组合。", 413
                    )
            except (NativeModelError, ValueError, RuntimeError, MemoryError) as exc:
                encoded = json.dumps(
                    {"error": str(exc), "status": getattr(exc, "status", 503)}
                ).encode()
            connection.send_bytes(encoded)
    except (EOFError, BrokenPipeError):
        pass
    except Exception as exc:  # noqa: BLE001 - sanitize failures at the isolated worker IPC boundary.
        connection.send_bytes(
            json.dumps({"error": type(exc).__name__, "status": 503}).encode()
        )
    finally:
        connection.close()


class ImpurityRuntime:
    def __init__(self):
        self.process = self.connection = None
        self.provenance = None
        self.guard = BoundedSemaphore(1)
        self.threads = configured_model_threads()

    @property
    def initialized(self):
        return (
            self.provenance is not None
            and self.process is not None
            and self.process.is_alive()
        )

    def load(self):
        context = multiprocessing.get_context("spawn")
        self.connection, child = context.Pipe()
        self.process = context.Process(target=_worker, args=(child,), daemon=True)
        self.process.start()
        child.close()
        if not self.connection.poll(90):
            self.close()
            raise RuntimeError("RXNMapper startup exceeded the load budget.")
        message = json.loads(self.connection.recv_bytes(MAX_RESPONSE_BYTES))
        if "ready" not in message:
            self.close()
            raise RuntimeError(
                "RXNMapper or a real native model dependency failed to load: "
                + message.get("error", "unknown")
            )
        self.provenance = message["ready"]
        return self

    def predict(self, body):
        if not self.initialized:
            raise NativeModelError("杂质模型未加载，请由环境运行入口重新启动。")
        if not self.guard.acquire(blocking=False):
            raise NativeModelError("杂质模型正在执行另一条分析。", 429)
        try:
            self.connection.send_bytes(body.model_dump_json().encode())
            deadline = time.monotonic() + REQUEST_TIMEOUT
            while not self.connection.poll(0.25):
                if not self.process.is_alive() or time.monotonic() >= deadline:
                    self.close()
                    raise NativeModelError(
                        "杂质分析超时或执行进程退出；没有返回预测结果。", 504
                    )
                status = Path(f"/proc/{self.process.pid}/status").read_text()
                rss = next(
                    (
                        int(line.split()[1]) * 1024
                        for line in status.splitlines()
                        if line.startswith("VmRSS:")
                    ),
                    0,
                )
                if rss > WORKER_RSS_BYTES:
                    self.close()
                    raise NativeModelError("杂质分析超过内存上限；没有返回预测结果。")
            message = json.loads(self.connection.recv_bytes(MAX_RESPONSE_BYTES))
            if "error" in message:
                raise NativeModelError(
                    "杂质计算未完成：" + message["error"], message["status"]
                )
            return message["result"]
        except (EOFError, OSError, json.JSONDecodeError) as exc:
            self.close()
            raise NativeModelError("杂质执行进程中断或返回无效数据。") from exc
        finally:
            self.guard.release()

    def close(self):
        self.provenance = None
        if self.process is not None:
            if self.process.is_alive():
                self.process.terminate()
            self.process.join(timeout=3)
            if self.process.is_alive():
                self.process.kill()
                self.process.join(timeout=3)
        if self.connection is not None:
            self.connection.close()
