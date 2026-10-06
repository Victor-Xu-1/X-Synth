"""Linux/WSL native ownership leases, verified process identities and bounded stop."""

from __future__ import annotations

import fcntl
import json
import os
import signal
import stat
import subprocess
import time
import uuid
from pathlib import Path

from .atomic_file import write_json
from .resource_metrics import IDENTITY_FIELDS, matching_process, owned_process_members, process_identity


class NativeLease:
    """One flock open description, retained by the launcher during child cleanup."""

    def __init__(self, state: Path, *, inherited_fd: int | None = None):
        directory = state.resolve() / "native"
        if directory.is_symlink():
            raise ValueError("Native ownership directory must not be a symlink")
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = directory / "owner.lock"
        self.fd = None
        fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600) if inherited_fd is None else os.dup(inherited_fd)
        try:
            metadata, expected = os.fstat(fd), path.lstat()
            if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.geteuid()
                    or metadata.st_mode & 0o077 or stat.S_ISLNK(expected.st_mode)
                    or (metadata.st_dev, metadata.st_ino) != (expected.st_dev, expected.st_ino)):
                raise ValueError("Invalid native ownership lease")
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError("Native runtime is already owned; no resources were allocated") from None
            self.fd = fd
        except BaseException:
            os.close(fd)
            raise
        finally:
            if inherited_fd is not None:
                os.close(inherited_fd)

    def close(self):
        if self.fd is not None:
            # LOCK_UN would also unlock an inherited launcher's open description.
            os.close(self.fd)
            self.fd = None


def signal_owned_process(identity: dict, signum: int) -> None:
    try:
        descriptor = os.pidfd_open(identity["pid"])
    except ProcessLookupError:
        return
    try:
        sample = matching_process(identity)
        if sample and sample["uid"] == os.geteuid() and sample["state"] not in {"Z", "X"}:
            try:
                signal.pidfd_send_signal(descriptor, signum)
            except ProcessLookupError:
                pass
    finally:
        os.close(descriptor)


class OwnedProcessGroup:
    def __init__(self, identity: dict, members: list[dict] | None = None):
        if (any(type(identity.get(key)) is not int for key in IDENTITY_FIELDS)
                or identity["pid"] <= 0 or identity["start_ticks"] <= 0
                or identity["pgid"] != identity["pid"]
                or identity["session_id"] != identity["pid"]
                or identity["uid"] != os.geteuid()):
            raise ValueError("Native process must own a verified new session")
        self.identity = identity
        self.members = [identity, *(members or [])]

    @classmethod
    def capture(cls, process: subprocess.Popen):
        return cls(process_identity(process.pid))

    def refresh(self):
        found = owned_process_members(self.members)
        self.members = [self.identity, *(sample for sample in found if sample["pid"] != self.identity["pid"])]

    def live(self):
        self.refresh()
        return [sample for member in self.members
                if (sample := matching_process(member)) and sample["state"] not in {"Z", "X"}]

    def signal(self, signum, sent=None):
        for sample in self.live():
            identity = tuple(sample[key] for key in IDENTITY_FIELDS)
            if sent is None or identity not in sent:
                signal_owned_process(sample, signum)
                if sent is not None:
                    sent.add(identity)

    def descriptor(self):
        return {**{key: self.identity[key] for key in IDENTITY_FIELDS},
                "members": [{key: sample[key] for key in IDENTITY_FIELDS} for sample in self.members]}


def stop_owned_groups(groups: list[OwnedProcessGroup], *, timeout: float, kill_timeout: float = 2) -> None:
    for signum, duration in ((signal.SIGTERM, timeout), (signal.SIGKILL, kill_timeout)):
        deadline = time.monotonic() + duration
        sent = set()
        while True:
            for group in groups:
                group.signal(signum, sent)
            if not any(group.live() for group in groups):
                return
            if time.monotonic() >= deadline:
                break
            time.sleep(min(0.05, max(0, deadline - time.monotonic())))
    raise RuntimeError("Owned native processes survived bounded stop escalation")


def read_runtime_manifest(state: Path) -> dict | None:
    path = state / "native/runtime.json"
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return None
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 1_048_576
            or metadata.st_uid != os.geteuid() or metadata.st_mode & 0o077):
        raise ValueError("Invalid private native runtime manifest")
    document = json.loads(path.read_text())
    if not isinstance(document, dict) or not isinstance(document.get("services"), dict):
        raise ValueError("Invalid native runtime manifest")
    return document


def cleanup_native_runtime(state: Path, *, generation: str | None = None, supervisor: dict | None = None):
    document = read_runtime_manifest(state)
    if not document:
        return
    if generation is not None and document.get("generation") != generation:
        raise RuntimeError("Native runtime generation changed; refusing foreign cleanup")
    boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    stored_boot = document.get("boot_id")
    if not stored_boot:
        # A stopped canonical unit must explicitly archive even an empty legacy file.
        raise RuntimeError("Legacy native runtime has no verifiable ownership; refusing cleanup")
    try:
        uuid.UUID(stored_boot)
    except (ValueError, TypeError, AttributeError):
        raise RuntimeError("Unverifiable native boot identity; refusing cleanup") from None
    if (document.get("schema_version") != 1
            or type(document.get("revision")) is not int or document["revision"] < 1
            or not isinstance(document.get("generation"), str) or not document["generation"]
            or not isinstance(document.get("supervisor"), dict)):
        raise RuntimeError("Unverifiable native lifecycle metadata; refusing cleanup")
    if stored_boot != boot_id:
        return
    owner = document.get("supervisor", {})
    if supervisor is not None and any(owner.get(key) != supervisor[key] for key in IDENTITY_FIELDS):
        raise RuntimeError("Native supervisor identity changed; refusing foreign cleanup")
    groups = {name: OwnedProcessGroup(descriptor, descriptor.get("members", []))
              for name, descriptor in document["services"].items() if "pid" in descriptor}
    if document.get("status") == "stopped" and not any(group.live() for group in groups.values()):
        return
    current = matching_process(owner)
    if current and current["state"] not in {"Z", "X"}:
        raise RuntimeError("Native supervisor is still alive; refusing concurrent cleanup")
    for names, timeout in (({"mcts", "retro_star"}, 30), (set(groups) - {"mcts", "retro_star"}, 10)):
        stop_owned_groups([group for name, group in groups.items() if name in names], timeout=timeout)
    document.update(status="stopped", revision=document.get("revision", 0) + 1)
    for descriptor in document["services"].values():
        descriptor["status"] = "stopped"
    write_json(state / "native/runtime.json", document)
