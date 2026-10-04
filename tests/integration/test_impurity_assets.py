"""Real installed wheel assets and isolated filesystem tampering regressions.

The installed environment is read-only. Tests copy official assets and their
real distribution metadata into pytest temporary directories; no model output
or RECORD entries are mocked.
"""

import importlib.metadata
import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps/askcos-v2/impurity_predictor"))
from native_mapper import MAPPER_MODEL_PATH, verify_mapper_assets


@pytest.fixture
def installed_distribution():
    return importlib.metadata.distribution("rxnmapper")


@pytest.fixture
def copied_distribution(installed_distribution, tmp_path):
    source = installed_distribution
    target = tmp_path / MAPPER_MODEL_PATH
    shutil.copytree(source.locate_file(MAPPER_MODEL_PATH), target)
    metadata_file = next(item for item in source.files if str(item).endswith(".dist-info/METADATA"))
    metadata_path = Path(source.locate_file(metadata_file)).parent
    copy = tmp_path / metadata_path.name
    shutil.copytree(metadata_path, copy)
    return importlib.metadata.PathDistribution(copy), target


def test_installed_official_assets_are_exact_regular_files_and_keep_the_pinned_identity(installed_distribution):
    path, identity = verify_mapper_assets(installed_distribution)
    assert path == Path(installed_distribution.locate_file(MAPPER_MODEL_PATH)).resolve(strict=True)
    assert identity == "2852c378f8dc429e099760dea974f568af60eb9140339ace5b68ccb9afc9c33a"


def test_real_copied_assets_keep_the_same_wheel_record_and_hash_identity(copied_distribution, installed_distribution):
    distribution, path = copied_distribution
    verified, identity = verify_mapper_assets(distribution)
    assert verified == path.resolve(strict=True)
    assert identity == verify_mapper_assets(installed_distribution)[1]


@pytest.mark.parametrize("name", ["model.safetensors", "pytorch_model.bin.index.json", "extra-directory"])
def test_extra_actual_directory_entries_fail_even_when_absent_from_record(copied_distribution, name):
    distribution, path = copied_distribution
    if name == "extra-directory":
        (path / name).mkdir()
    else:
        shutil.copyfile(path / "pytorch_model.bin", path / name)
    with pytest.raises(ValueError, match="extra entries"):
        verify_mapper_assets(distribution)


def test_missing_actual_asset_is_rejected(copied_distribution):
    distribution, path = copied_distribution
    (path / "config.json").unlink()
    with pytest.raises(ValueError, match="incomplete|missing"):
        verify_mapper_assets(distribution)


def test_directory_cannot_replace_a_required_regular_file(copied_distribution):
    distribution, path = copied_distribution
    (path / "vocab.txt").unlink()
    (path / "vocab.txt").mkdir()
    with pytest.raises(ValueError, match="regular nonsymlink"):
        verify_mapper_assets(distribution)


def test_symlink_to_even_the_official_verified_weight_is_rejected(copied_distribution, installed_distribution):
    distribution, path = copied_distribution
    weight = path / "pytorch_model.bin"
    weight.unlink()
    weight.symlink_to(installed_distribution.locate_file(MAPPER_MODEL_PATH + "/pytorch_model.bin"))
    with pytest.raises(ValueError, match="regular nonsymlink"):
        verify_mapper_assets(distribution)


@pytest.mark.parametrize("segment", ["model", "models_parent"])
def test_symlinked_model_or_parent_cannot_escape_verified_distribution(copied_distribution, tmp_path, segment):
    distribution, path = copied_distribution
    directory = path if segment == "model" else tmp_path / "rxnmapper/models"
    escaped = tmp_path / "outside-distribution"
    directory.rename(escaped)
    directory.symlink_to(escaped, target_is_directory=True)
    with pytest.raises(ValueError, match="without symlinks"):
        verify_mapper_assets(distribution)


def test_corrupted_regular_weight_is_rejected_before_loading(copied_distribution):
    distribution, path = copied_distribution
    shutil.copyfile(path / "config.json", path / "pytorch_model.bin")
    with pytest.raises(ValueError, match="official 0.4.3 wheel"):
        verify_mapper_assets(distribution)
