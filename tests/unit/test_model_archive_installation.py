import hashlib
import io
import tarfile
from zipfile import ZipFile

import pytest

from scripts.data_import.install_askcos_model import install_archive


def archive_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_explicit_zip_assets_remain_supported_and_immutable(tmp_path):
    source = tmp_path / "source.zip"
    with ZipFile(source, "w") as archive:
        archive.writestr("model_latest.pt", b"weights")
        archive.writestr("templates.jsonl", b"index")
    options = dict(output=tmp_path / "installed", expected_sha256=archive_hash(source),
                   source_url="https://example.org/model.zip")
    metadata = install_archive(source, **options)
    assert metadata["files"]["model_latest.pt"] == hashlib.sha256(b"weights").hexdigest()
    assert (options["output"] / "templates.jsonl").read_bytes() == b"index"
    with pytest.raises(FileExistsError):
        install_archive(source, **options)


def make_tar(path, *, link=False):
    with tarfile.open(path, "w:gz") as archive:
        info = tarfile.TarInfo("v1/weights.h5")
        if link:
            info.type = tarfile.SYMTYPE
            info.linkname = "../../outside"
            archive.addfile(info)
        else:
            content = b"weights"
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))


def test_selected_tar_members_install_without_extracting_archive_paths(tmp_path):
    source = tmp_path / "source.tar.gz"
    make_tar(source)
    output = tmp_path / "model"
    metadata = install_archive(source, output=output, expected_sha256=archive_hash(source),
                               source_url="https://example.org/weights.tar.gz", members=("weights.h5",),
                               archive_format="tar", member_prefix="v1")
    assert (output / "weights.h5").read_bytes() == b"weights"
    assert not (output / "v1").exists()
    assert metadata["member_prefix"] == "v1"
    assert (output / "asset.json").is_file()


@pytest.mark.parametrize("prefix", ["/v1", "../v1", "v1/../other", "v1//other", "v1\\other"])
def test_tar_prefixes_reject_traversal_before_staging(tmp_path, prefix):
    source = tmp_path / "source.tar.gz"
    make_tar(source)
    with pytest.raises(ValueError, match="prefix"):
        install_archive(source, output=tmp_path / "model", expected_sha256=archive_hash(source),
                        source_url="https://example.org/model", members=("weights.h5",),
                        archive_format="tar", member_prefix=prefix)
    assert not (tmp_path / "model.staging").exists()


def test_tar_links_and_corrupt_archives_never_leave_installed_assets(tmp_path):
    source = tmp_path / "source.tar.gz"
    make_tar(source, link=True)
    output = tmp_path / "model"
    options = dict(output=output, expected_sha256=archive_hash(source),
                   source_url="https://example.org/model", members=("weights.h5",),
                   archive_format="tar", member_prefix="v1")
    with pytest.raises(ValueError, match="regular"):
        install_archive(source, **options)
    assert not output.exists()
    assert not output.with_name("model.staging").exists()
    options["expected_sha256"] = "0" * 64
    with pytest.raises(ValueError, match="checksum"):
        install_archive(source, **options)


@pytest.mark.parametrize("members", [("../model",), ("a\\b",), ("weights.h5", "weights.h5"), ("asset.json",)])
def test_asset_names_and_duplicates_are_rejected(tmp_path, members):
    source = tmp_path / "source.tar.gz"
    make_tar(source)
    with pytest.raises(ValueError, match="filenames"):
        install_archive(source, output=tmp_path / "model", expected_sha256=archive_hash(source),
                        source_url="https://example.org/model", members=members)
