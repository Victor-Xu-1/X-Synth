"""Focused regression for the project-specific merged-PR release policy."""

import copy
import json
import unittest

from packages.platform.release_version import (
    RELEASE_FILES, STATE_FILE, advance_version, prepare_release, validate_metadata,
)


def release_files(version="0.1.0", receipts=()):
    state = {
        "schema_version": 1,
        "baseline": {"revision": "a" * 40, "version": "0.1.0"},
        "merged_prs": list(receipts),
    }
    return {
        "VERSION": version + "\n",
        STATE_FILE: json.dumps(state),
        "apps/web/package.json": json.dumps({"name": "x-synth-web", "version": version}),
        "apps/web/package-lock.json": json.dumps({
            "version": version, "packages": {"": {"version": version}, "dep": {"version": "2.3.4"}},
        }),
    }


class ReleasePolicyTests(unittest.TestCase):
    def test_carry_and_batch_count(self):
        for before, count, after in (
            ("0.1.0", 1, "0.1.1"), ("0.1.98", 1, "0.1.99"),
            ("0.1.99", 1, "0.2.0"), ("0.9.99", 1, "1.0.0"),
            ("1.9.99", 1, "2.0.0"), ("0.1.98", 3, "0.2.1"),
            ("0.1.0", 1000, "1.1.0"), ("0.1.0", 0, "0.1.0"),
        ):
            with self.subTest(before=before, count=count):
                self.assertEqual(advance_version(before, count), after)

    def test_invalid_versions_and_counts_fail_closed(self):
        for value in ("v0.1.0", "0.10.0", "0.1.100", "01.1.0", "0.1.0rc1", "-1.1.0", "0.1"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                advance_version(value)
        for count in (-1, True, 1.5, "1"):
            with self.subTest(count=count), self.assertRaises(ValueError):
                advance_version("0.1.0", count)

    def test_unique_receipts_and_dependency_metadata_are_preserved(self):
        files = release_files()
        original = copy.deepcopy(files)
        first = {"number": 55, "merge_commit_sha": "b" * 40}
        second = {"number": 56, "merge_commit_sha": "c" * 40}
        updated, counted = prepare_release(files, [first, first, second])
        self.assertEqual(counted, [55, 56])
        self.assertEqual(set(updated), set(RELEASE_FILES))
        self.assertEqual(updated["VERSION"], "0.1.2\n")
        self.assertEqual(json.loads(updated["apps/web/package-lock.json"])["packages"]["dep"]["version"], "2.3.4")
        self.assertEqual(files, original)
        validate_metadata(updated)
        again, counted = prepare_release(updated, [first, second])
        self.assertEqual(again, {})
        self.assertEqual(counted, [])

    def test_drift_conflicts_and_corrupt_receipts_are_refused(self):
        files = release_files()
        files["VERSION"] = "0.1.1\n"
        with self.assertRaises(ValueError):
            prepare_release(files, [])
        receipt = {"number": 55, "merge_commit_sha": "b" * 40}
        files = release_files("0.1.1", [receipt])
        with self.assertRaises(ValueError):
            prepare_release(files, [{"number": 55, "merge_commit_sha": "c" * 40}])
        for invalid in ({"number": True, "merge_commit_sha": "b" * 40},
                        {"number": 0, "merge_commit_sha": "b" * 40},
                        {"number": 55, "merge_commit_sha": "../main"}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                prepare_release(release_files(), [invalid])
        with self.assertRaises(ValueError):
            validate_metadata(release_files("0.1.2", [receipt, receipt]))


if __name__ == "__main__":
    unittest.main()
