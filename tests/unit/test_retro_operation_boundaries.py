"""Exercise owned gateway boundaries without importing database configuration."""

import ast
import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel

from packages.adapters.askcos.native_failure_diagnostics import native_failure_context
from packages.adapters.askcos.native_http import NativeProtocolError


ROOT = Path(__file__).resolve().parents[2]
CORE = ROOT / "apps/askcos-v2/askcos2_core"


def load_controller():
    path = CORE / "wrappers/retro/controller.py"
    parsed = ast.parse(path.read_text())
    declaration = next(node for node in parsed.body if isinstance(node, ast.ClassDef)
                       and node.name == "RetroController")
    declaration.decorator_list = []
    declaration.body = [node for node in declaration.body if not isinstance(node, ast.FunctionDef)
                        or node.name == "call_sync"]
    body = [node for node in parsed.body if isinstance(node, ast.ImportFrom)
            and node.module == "packages.adapters.askcos.native_failure_diagnostics"]
    body += [node for node in parsed.body if isinstance(node, ast.ClassDef)
             and node.name in {"RetroResult", "RetroResponse"}]
    body.append(declaration)
    namespace = {
        "BaseModel": BaseModel, "Any": object, "BaseResponse": BaseModel,
        "BaseWrapper": type("BaseWrapper", (), {"name": "retro_controller"}),
        "RetroInput": BaseModel,
    }
    exec(compile(ast.Module(body=body, type_ignores=[]), str(path), "exec"), namespace)
    instance = namespace["RetroController"]()
    instance.convert_input = lambda **kwargs: kwargs["input"]
    instance.convert_response = lambda **kwargs: kwargs["wrapper_response"]
    return instance, namespace


class Input(BaseModel):
    backend: str = "template_relevance"
    model_name: str = "pistachio"
    smiles: list[str] = ["CCO"]


def configure(namespace, cache, wrapper):
    namespace["get_util_registry"] = lambda: SimpleNamespace(get_util=lambda **kwargs: cache)
    namespace["get_wrapper_registry"] = lambda: SimpleNamespace(get_wrapper=lambda **kwargs: wrapper)


def failure():
    raise NativeProtocolError("private-token in http://secret.invalid", code="native_call_timeout",
                              recoverable=True, service="template_relevance")


def miss(**kwargs):
    raise KeyError("Cache miss")


def diagnostics(caplog):
    records = [record.message.split(": ", 1)[1] for record in caplog.records
               if record.message.startswith("Native operation failed: ")]
    return [json.loads(record) for record in records]


def test_cache_lookup_failure_records_the_actual_operation_without_fallback(caplog):
    controller, namespace = load_controller()
    calls = []
    cache = SimpleNamespace(get=lambda **kwargs: failure())
    configure(namespace, cache, SimpleNamespace(call_sync=lambda value: calls.append(value)))
    with caplog.at_level(logging.ERROR), pytest.raises(NativeProtocolError) as raised:
        controller.call_sync(Input())
    assert calls == [] and raised.value.service == "template_relevance"
    assert diagnostics(caplog)[0]["operation"] == "retro_cache_lookup"
    assert "private-token" not in caplog.text and "secret.invalid" not in caplog.text


@pytest.mark.parametrize("stage", ["retro_backend_call", "retro_response_conversion", "retro_cache_write"])
def test_cache_miss_distinguishes_backend_conversion_and_cache_write_errors(stage, caplog):
    controller, namespace = load_controller()
    cache = SimpleNamespace(get=miss, add=lambda **kwargs: None)
    wrapper = SimpleNamespace(call_sync=lambda value: SimpleNamespace(status_code=200, result=[[]]))
    if stage == "retro_backend_call":
        wrapper.call_sync = lambda value: failure()
    elif stage == "retro_response_conversion":
        controller.convert_response = lambda **kwargs: failure()
    else:
        cache.add = lambda **kwargs: failure()
    configure(namespace, cache, wrapper)
    with caplog.at_level(logging.ERROR), pytest.raises(NativeProtocolError):
        controller.call_sync(Input())
    observed = diagnostics(caplog)
    assert len(observed) == 1 and observed[0]["operation"] == stage
    assert len(observed[0]["input_sha256"]) == 64


def test_typed_cached_result_does_not_call_backend_or_emit_failure(caplog):
    controller, namespace = load_controller()
    cache = SimpleNamespace(get=lambda **kwargs: {"status_code": 200, "message": "", "result": [[]]})
    configure(namespace, cache, SimpleNamespace(call_sync=lambda value: pytest.fail("Cached call dispatched")))
    assert controller.call_sync(Input()).result == [[]]
    assert diagnostics(caplog) == []


def test_invalid_cached_response_is_not_used_or_silently_recomputed(caplog):
    controller, namespace = load_controller()
    cache = SimpleNamespace(get=lambda **kwargs: {"status_code": 200, "message": "", "result": None})
    configure(namespace, cache, SimpleNamespace(call_sync=lambda value: pytest.fail("Invalid cache dispatched")))
    with caplog.at_level(logging.ERROR), pytest.raises(ValueError):
        controller.call_sync(Input())
    assert diagnostics(caplog)[0]["operation"] == "retro_cache_decode"


def load_cache(collection):
    path = CORE / "utils/cache.py"
    parsed = ast.parse(path.read_text())
    declaration = next(node for node in parsed.body if isinstance(node, ast.ClassDef)
                       and node.name == "CacheController")
    declaration.decorator_list = []
    declaration.body = [node for node in declaration.body if isinstance(node, ast.FunctionDef)
                        and node.name in {"key", "get", "add"}]
    body = [node for node in parsed.body if isinstance(node, ast.ImportFrom)
            and node.module == "packages.adapters.askcos.native_failure_diagnostics"]
    body.append(declaration)
    namespace = {"BaseModel": BaseModel, "hashlib": hashlib, "json": json,
                 "jsonable_encoder": jsonable_encoder, "datetime": datetime,
                 "timedelta": timedelta, "timezone": timezone}
    exec(compile(ast.Module(body=body, type_ignores=[]), str(path), "exec"), namespace)
    instance = namespace["CacheController"]()
    instance.collection, instance.scope = collection, "asset-identity"
    return instance


def test_real_cache_miss_stays_normal_and_asset_scoping_is_unchanged(caplog):
    queries = []
    cache = load_cache(SimpleNamespace(find_one=lambda query: queries.append(query)))
    original_key = cache.key("retro_controller", Input())
    with pytest.raises(KeyError, match="Cache miss"):
        cache.get("retro_controller", Input())
    assert diagnostics(caplog) == []
    assert queries[0]["_id"] == original_key and "$gt" in queries[0]["expires"]
    cache.scope = "different-asset-identity"
    assert cache.key("retro_controller", Input()) != original_key


def test_actual_cache_database_failure_keeps_its_type_and_does_not_become_a_miss(caplog):
    error = RuntimeError("private-token database error")

    def broken_read(query):
        raise error

    cache = load_cache(SimpleNamespace(find_one=broken_read))
    with caplog.at_level(logging.ERROR), pytest.raises(RuntimeError) as raised:
        cache.get("retro_controller", Input())
    assert raised.value is error
    assert native_failure_context(error)["operation"] == "cache_lookup"
    assert "private-token" not in caplog.text


def test_actual_cache_write_failure_cannot_replace_the_successful_response(caplog):
    error = RuntimeError("private-token write error")

    def broken_write(*args, **kwargs):
        raise error

    cache = load_cache(SimpleNamespace(update_one=broken_write))
    _, namespace = load_controller()
    response = namespace["RetroResponse"](status_code=200, message="", result=[[]])
    before = response.model_dump()
    with caplog.at_level(logging.ERROR), pytest.raises(RuntimeError) as raised:
        cache.add("retro_controller", Input(), response)
    assert raised.value is error and response.model_dump() == before
    assert native_failure_context(error)["operation"] == "cache_write"
    assert "private-token" not in caplog.text
