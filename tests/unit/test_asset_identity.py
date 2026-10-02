from packages.platform.asset_identity import content_digest


def test_asset_identity_changes_with_real_content(tmp_path):
    path = tmp_path / "model.asset"
    path.write_bytes(b"first asset")
    first = content_digest(path)
    assert content_digest(path) == first
    path.write_bytes(b"different asset")
    assert content_digest(path) != first
