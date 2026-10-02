from scripts.operations.export_public_source import is_public_source


def test_publication_keeps_source_and_third_party_notices():
    for path in (
        "README.md", "NOTICE", "LICENSE", ".env.example", "pyproject.toml",
        "apps/askcos-v2/askcos2_core/.env.example",
        "apps/askcos-v2/retro/template_relevance/LICENSE_REAXYS_MODEL",
        "packages/orchestrator/pipeline.py",
        "engines/aizynthfinder/models/USPTO/config.yml",
        "apps/web/package-lock.json",
        ".github/workflows/ci.yml",
    ):
        assert is_public_source(path), path


def test_publication_excludes_secrets_models_and_private_runtime_data():
    for path in (
        ".env", "RECOVERY-STATUS.json", "../credentials.json", "/etc/shadow",
        "apps/askcos-v2/askcos2_core/.env",
        "apps/askcos-v2/askcos2_core/askcos.ssl.key",
        "apps/askcos-v2/askcos2_core/data/db/reactions/pistachio.json.gz",
        "engines/aizynthfinder/models/uspto_model.onnx",
        "apps/askcos-v2/atom_map/wln/model/model.ckpt-100.data-00000-of-00001",
        "engines/aizynthfinder/models/zinc_stock.hdf5",
        "engines/aizynthfinder/models/uspto_templates.csv.gz",
        "tests/real-cases/supplier_real_batch_20260702_targets.smi",
        "docs/test-results/previous-task.md",
        "apps/web/coverage/summary.json",
        "apps/askcos-v2/.runtime-run-proxy.sh",
        "apps/askcos-v2/solubility_fusion_cycle/Density/qspr_density_model.pkl",
        "apps/askcos-v2/atom_map/wln/utilities/efgs/output/analysis.csv",
        "engines/aizynthfinder/models/weights.npz",
        "apps/askcos-v2/molecular_complexity/molcomplex/metrics/fpscores.pkl.gz",
    ):
        assert not is_public_source(path), path
