"""AST imports, source-read edges and pinned dependency graph analysis."""

from __future__ import annotations

import ast
import json
import os
import posixpath
import re
import shlex
import subprocess
from collections import defaultdict
from pathlib import PurePosixPath

WEB = "apps/web/"
SOURCE = WEB + "src/"
SOURCE_EXTENSIONS = {".js", ".vue", ".css", ".scss", ".json"}


class ScopeError(ValueError):
    pass


def differing(before: dict, after: dict) -> set[str]:
    return {
        key for key in before.keys() | after.keys() if before.get(key) != after.get(key)
    }


def pinned_requirements(values: list[str]) -> dict[str, str]:
    result = {}
    for value in values:
        name, separator, version = value.partition("==")
        if not separator or not re.fullmatch(r"[A-Za-z0-9_.-]+", name) or not version:
            raise ScopeError(f"Unmapped Python requirement syntax: {value}")
        result[re.sub(r"[-_.]+", "-", name).lower()] = version
    return result


def lock_requirements(text: str) -> dict[str, list[str]]:
    result = {}
    for line in text.replace("\\\n", " ").splitlines():
        tokens = shlex.split(line, comments=True)
        if not tokens:
            continue
        name = next(iter(pinned_requirements([tokens[0]])))
        if any(not token.startswith("--hash=sha256:") for token in tokens[1:]):
            raise ScopeError(f"Unmapped Python lock entry: {tokens[0]}")
        result[name] = tokens
    return result


def python_imports(text: str) -> set[str]:
    imports = set()
    for node in ast.walk(ast.parse(text)):
        if isinstance(node, ast.Import):
            imports.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imports.add(node.module)
    return imports


FRONTEND_PARSER = r"""
const { parse } = require('@babel/parser');
const { parse: parseVue } = require('@vue/compiler-sfc');
async function main() {
let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
const sources = JSON.parse(input);
const output = {};
for (const [file, source] of Object.entries(sources)) {
  const record = { imports: [], files: [], dynamic: false };
  let scripts = [source];
  if (file.endsWith('.vue')) {
    const { descriptor, errors } = parseVue(source, { filename: file });
    if (errors.length) throw new Error(`${file}: ${errors.join(', ')}`);
    scripts = [descriptor.script, descriptor.scriptSetup].filter(Boolean).map(s => s.content);
    for (const block of [descriptor.script, ...descriptor.styles]) {
      if (block && block.src) record.imports.push(block.src);
    }
  }
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'StringLiteral') record.files.push(node.value);
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source)
      record.imports.push(node.source.value);
    if (node.type === 'CallExpression' && (node.callee.type === 'Import' ||
        (node.callee.type === 'Identifier' && node.callee.name === 'require'))) {
      if (node.arguments[0] && node.arguments[0].type === 'StringLiteral') record.imports.push(node.arguments[0].value);
      else record.dynamic = true;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  }
  for (const script of scripts) {
    try {
      const tree = parse(script, { sourceType: 'unambiguous', plugins: ['importAttributes'] });
      walk(tree);
      const body = tree.program.body;
      if (file.startsWith('apps/web/src/i18n/catalog-') && !tree.program.directives.length && body.length === 1 &&
          body[0].type === 'ExportDefaultDeclaration' && body[0].declaration.type === 'ArrayExpression') {
        const pairs = body[0].declaration.elements;
        if (pairs.every(pair => pair?.type === 'ArrayExpression' && pair.elements.length === 2 &&
            pair.elements.every(item => item?.type === 'StringLiteral'))) {
          const entries = pairs.map(pair => pair.elements.map(item => item.value));
          if (new Set(entries.map(([key]) => key)).size === entries.length) record.catalog = Object.fromEntries(entries);
        }
      }
    }
    catch (error) { throw new Error(`${file}: ${error.message}`); }
  }
  output[file] = record;
}
process.stdout.write(JSON.stringify(output));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
"""


def parse_frontend(snapshot) -> dict:
    sources = {
        path: snapshot.text(path)
        for path in sorted(snapshot.files)
        if path.startswith(SOURCE) and path.endswith((".js", ".vue"))
    }
    try:
        result = subprocess.run(
            [os.environ.get("CI_SCOPE_NODE", "node"), "-e", FRONTEND_PARSER],
            cwd=snapshot.root / "apps/web",
            input=json.dumps(sources),
            text=True,
            capture_output=True,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        raise ScopeError(
            "Frontend AST parser failed: " + (exc.stderr or str(exc)).strip()
        ) from exc
    return json.loads(result.stdout)


def additive_catalog_checks(path: str, old: dict, new: dict, files: set[str]) -> set[str]:
    """Literal additions do not change existing messages; retain aggregate validation."""
    if not path.startswith(SOURCE + "i18n/catalog-"):
        return set()
    previous, current = old.get("catalog"), new.get("catalog")
    if not isinstance(previous, dict) or not isinstance(current, dict):
        return set()
    if any(key not in current or current[key] != value for key, value in previous.items()):
        return set()
    family = PurePosixPath(path).stem.split("-")[1]
    checks = {SOURCE + "i18n/catalog.test.js", SOURCE + f"i18n/catalog-{family}.test.js"}
    return checks if checks <= files else set()


def local_module(owner: str, specifier: str, files: set[str]) -> str | None:
    value = specifier.split("?", 1)[0]
    if value.startswith("@/"):
        path = SOURCE + value[2:]
    elif value.startswith("."):
        path = posixpath.normpath(posixpath.join(posixpath.dirname(owner), value))
    else:
        return None
    for candidate in (
        path,
        path + ".js",
        path + ".vue",
        path + ".json",
        path + "/index.js",
    ):
        if candidate in files:
            return candidate
    raise ScopeError(f"Unresolved local import in {owner}: {specifier}")


def frontend_graph(records: dict, files: set[str]) -> dict[str, set[str]]:
    graph = defaultdict(set)
    for owner, record in records.items():
        for specifier in record["imports"]:
            resolved = local_module(owner, specifier, files)
            if resolved:
                graph[owner].add(resolved)
        if owner.endswith(".test.js"):
            for literal in record["files"]:
                if PurePosixPath(literal).suffix not in SOURCE_EXTENSIONS:
                    continue
                for directory in (posixpath.dirname(owner), SOURCE, SOURCE + "views/"):
                    candidate = posixpath.normpath(posixpath.join(directory, literal))
                    if candidate in files and candidate != owner:
                        graph[owner].add(candidate)
    return graph


def npm_package(specifier: str) -> str | None:
    if specifier.startswith((".", "@/", "node:")):
        return None
    return (
        "/".join(specifier.split("/")[:2])
        if specifier.startswith("@")
        else specifier.split("/")[0]
    )


def lock_closure(packages: dict, dependency: str) -> set[str]:
    pending = ["node_modules/" + dependency]
    reached = set()
    while pending:
        path = pending.pop()
        if path in reached or path not in packages:
            continue
        reached.add(path)
        entry = packages[path]
        names = (
            entry.get("dependencies", {}).keys()
            | entry.get("optionalDependencies", {}).keys()
            | entry.get("peerDependencies", {}).keys()
        )
        for name in names:
            directory = path
            while True:
                candidate = (
                    directory + "/node_modules/" + name
                    if directory
                    else "node_modules/" + name
                )
                if candidate in packages:
                    pending.append(candidate)
                    break
                if not directory:
                    break
                directory = (
                    directory.rsplit("/node_modules/", 1)[0]
                    if "/node_modules/" in directory
                    else ""
                )
    return reached
