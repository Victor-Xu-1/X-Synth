from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import re
import subprocess
from typing import Any


from .config import referenced_asset_paths


@dataclass(frozen=True)
class AiZynthFinderRunResult:
    solved: bool
    routes: list[dict[str, Any]]
    stats: dict[str, Any]
    output_path: Path


@dataclass(frozen=True)
class AiZynthFinderAdapter:
    executable: str
    config_path: Path
    cwd: Path | None = None
    python_args: tuple[str, ...] = ()

    def config_for_model(self, model_name: str | None = None) -> Path:
        if not model_name or model_name == "default":
            candidate = self.config_path
        else:
            candidate = self.config_path.parent / model_name / "config.yml"
        if not candidate.is_file():
            raise FileNotFoundError(
                f"AiZynthFinder model config not found: {candidate}. "
                "Do not fall back to another model silently."
            )
        return candidate

    def referenced_assets(self, model_name: str | None = None) -> list[Path]:
        return referenced_asset_paths(self.config_for_model(model_name))

    def validate_assets(self, model_name: str | None = None) -> None:
        missing = [path for path in self.referenced_assets(model_name) if not path.is_file()]
        if missing:
            formatted = ", ".join(str(path) for path in missing)
            raise FileNotFoundError(f"Missing AiZynthFinder model assets: {formatted}")

    def build_command(
        self,
        smiles: str,
        output_path: Path,
        model_name: str | None = None,
        expansion_policies: tuple[str, ...] = ("uspto", "ringbreaker"),
        stock: str = "zinc",
        filter_policy: str = "uspto",
        iteration_limit: int | None = None,
        max_transforms: int | None = None,
        time_limit: int | None = None,
    ) -> list[str]:
        config = self.config_for_model(model_name)
        command = [
            self.executable,
            *self.python_args,
            "-m",
            "packages.adapters.aizynthfinder.runner",
            "--config",
            str(config),
            "--smiles",
            smiles,
            "--output",
            str(output_path),
            "--stock",
            stock,
            "--filter-policy",
            filter_policy,
        ]
        for policy in expansion_policies:
            command.extend(["--expansion-policy", policy])
        if iteration_limit is not None:
            command.extend(["--iteration-limit", str(iteration_limit)])
        if max_transforms is not None:
            command.extend(["--max-transforms", str(max_transforms)])
        if time_limit is not None:
            command.extend(["--time-limit", str(time_limit)])
        return command

    def run(
        self,
        smiles: str,
        output_path: Path,
        model_name: str | None = None,
        timeout_sec: int = 1800,
        stock: str = "zinc",
        iteration_limit: int | None = None,
        max_transforms: int | None = None,
        time_limit: int | None = None,
    ) -> AiZynthFinderRunResult:
        self.validate_assets(model_name)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        cwd = self.cwd or Path.cwd()
        env["PYTHONPATH"] = f"{cwd}:{env.get('PYTHONPATH', '')}".rstrip(":")
        proc = subprocess.run(
            self.build_command(
                smiles,
                output_path,
                model_name=model_name,
                stock=stock,
                iteration_limit=iteration_limit,
                max_transforms=max_transforms,
                time_limit=time_limit,
            ),
            cwd=cwd,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_sec,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                "AiZynthFinder run failed "
                f"(exit={proc.returncode}). stdout={proc.stdout[-1000:]} stderr={proc.stderr[-2000:]}"
            )
        payload = _load_json_output(output_path, proc.stdout)
        return AiZynthFinderRunResult(
            solved=bool(payload.get("solved")),
            routes=list(payload.get("routes") or []),
            stats=dict(payload.get("stats") or {}),
            output_path=output_path,
        )


def _load_json_output(output_path: Path, stdout: str) -> dict[str, Any]:
    if output_path.is_file():
        import json

        return json.loads(output_path.read_text(encoding="utf-8"))

    match = re.search(r"(\{.*\})\s*$", stdout, re.DOTALL)
    if not match:
        raise FileNotFoundError(f"AiZynthFinder output was not written: {output_path}")
    import json

    return json.loads(match.group(1))
