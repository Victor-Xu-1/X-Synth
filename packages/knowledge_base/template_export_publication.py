"""No-replace publication and ownership-aware rollback of one export bundle."""

import os
from pathlib import Path

from packages.platform.immutable_sqlite import file_identity

EXPORT_MANIFEST = "runtime_template_assets.json"


def require_new_destination(output: Path):
    if output.exists() or output.is_symlink():
        raise FileExistsError("Template export destinations are immutable; choose a new directory")


def publish_export(staging: Path, output: Path, snapshot):
    files = sorted((staging / "askcos_templates").iterdir())
    files.append(staging / EXPORT_MANIFEST)
    if any(not path.is_file() or path.is_symlink() for path in files):
        raise ValueError("Export bundles contain only regular files")
    directories, published = [], []
    try:
        snapshot.check()
        output.mkdir(mode=0o700)
        directories.append(output)
        template_dir = output / "askcos_templates"
        template_dir.mkdir(mode=0o700)
        directories.append(template_dir)
        for source in files:
            snapshot.check()
            target = output / source.relative_to(staging)
            source.chmod(0o444)
            os.link(source, target)
            published.append((target, file_identity(target)))
        snapshot.check()
        for directory in reversed(directories):
            directory.chmod(0o755)
    except BaseException:
        for target, identity in reversed(published):
            try:
                if file_identity(target) == identity:
                    target.unlink()
            except (OSError, ValueError):
                # A removed or replaced entry is no longer this exporter's file.
                continue
        # Never recursively delete the destination: a concurrent actor may have
        # added a file that belongs to them, not this exporter.
        for directory in reversed(directories):
            try:
                directory.rmdir()
            except OSError:
                pass
        raise
