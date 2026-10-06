"""Fail-closed proof that a native upgrade changes only route projection."""

import ast
from pathlib import Path

NATIVE_DIRECTORIES = ("askcos2_core", "tree_search", "retro/template_relevance")
PROJECTION_FILES = {
    "tree_search/mcts/utils.py": {"prune", "get_paths", "chunk_by_comma", "generate_unique_node"},
    "tree_search/retro_star/utils.py": {"prune", "get_paths", "chunk_by_comma", "generate_unique_node"},
    "tree_search/retro_star/retro_star_controller.py": {"RetroStar.enumerate_paths"},
}
PROJECTION_IMPORTS = {
    "packages.adapters.askcos.route_reachability",
    "packages.adapters.askcos.route_enumeration",
}


def search_semantics(source: str, allowed: set[str]) -> str:
    module = ast.parse(source)
    body = []
    for node in module.body:
        if isinstance(node, ast.FunctionDef) and node.name in allowed:
            continue
        if isinstance(node, ast.ImportFrom) and node.module in PROJECTION_IMPORTS:
            continue
        if isinstance(node, ast.Import) and all(
            alias.name in {"uuid", "itertools"} for alias in node.names
        ):
            continue
        if isinstance(node, ast.ClassDef):
            node.body = [
                item for item in node.body
                if not (
                    isinstance(item, ast.FunctionDef)
                    and f"{node.name}.{item.name}" in allowed
                )
            ]
        body.append(node)
    module.body = body
    return ast.dump(module, include_attributes=False)


def verify_projection_only(old_source: Path, new_source: Path) -> list[str]:
    """Compare every fingerprinted native file, not just Git's changed list."""
    def files(root):
        native = root / "apps/askcos-v2"
        return {
            str(path.relative_to(native)): path
            for directory in NATIVE_DIRECTORIES
            for path in (native / directory).rglob("*.py")
        }

    old, new = files(old_source), files(new_source)
    if not old or old.keys() != new.keys():
        raise ValueError("Native search files were added or removed; checkpoint cannot be migrated")
    changed = []
    for name in sorted(old):
        before, after = old[name].read_bytes(), new[name].read_bytes()
        if before == after:
            continue
        if name not in PROJECTION_FILES or (
            search_semantics(before.decode(), PROJECTION_FILES[name])
            != search_semantics(after.decode(), PROJECTION_FILES[name])
        ):
            raise ValueError(f"Search semantics changed: {name}")
        changed.append(name)
    if not changed:
        raise ValueError("No reviewed native projection change was found")
    return changed
