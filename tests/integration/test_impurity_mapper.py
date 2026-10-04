"""Real offline loading and mapping parity, not impurity-chemistry validation.

Run in the dedicated impurity environment with actual 9911/9611 dependencies.
Loader spies call the real implementation; no model results are substituted.
"""

import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps/askcos-v2/impurity_predictor"))
from native_mapper import load_models
from native_session import predict_impurities
from packages.adapters.askcos.impurities import (
    RANKING_STRATEGY, ImpurityInput, ImpurityResult, canonical_input, origin_ranking_score, validate_mapping,
)
from packages.workspace.structure_validation import canonical_structure


@pytest.fixture(scope="module")
def models():
    os.environ.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
                       "HF_HUB_DISABLE_IMPLICIT_TOKEN": "1", "CUDA_VISIBLE_DEVICES": ""})
    import torch
    from transformers import AlbertModel

    with patch.object(AlbertModel, "from_pretrained", wraps=AlbertModel.from_pretrained) as loader:
        with patch.object(torch, "load", wraps=torch.load) as checkpoint_loader:
            result = load_models()
    assert loader.call_count == 1
    kwargs = loader.call_args.kwargs
    assert kwargs["local_files_only"] is True
    assert kwargs["trust_remote_code"] is False
    assert kwargs["weights_only"] is True
    assert kwargs["use_safetensors"] is False
    assert kwargs["attn_implementation"] == "eager"
    assert kwargs["output_attentions"] is True
    assert checkpoint_loader.call_count > 0
    for call in checkpoint_loader.call_args_list:
        assert call.kwargs["weights_only"] is True
        assert Path(call.args[0]).name == "pytorch_model.bin"
    return result


@pytest.fixture(scope="module")
def official_mapper(models):
    from rxnmapper import RXNMapper

    # Comparison-only reference using the same verified assets, not a fallback.
    return RXNMapper()


def test_real_loader_uses_verified_local_albert_and_official_tokenizer(models):
    from rxnmapper.tokenization_smiles import SmilesTokenizer

    mapper = models[0]
    assert mapper.device.type == "cpu"
    assert mapper.model.config.model_type == "albert"
    assert mapper.model.config._attn_implementation == "eager"
    assert type(mapper.tokenizer) is SmilesTokenizer
    assert mapper.model.config.max_position_embeddings == 512


@pytest.mark.parametrize("reaction", [
    "CC(=O)Cl.CN>>CNC(C)=O",
    "C[C@H](O)C(=O)O>>C[C@H](O)C(=O)O",
    "C[NH3+].[Cl-]>>C[NH3+].[Cl-]",
    "[13CH3]O>>[13CH3]O",
    "[2H]CO>>[2H]CO",
])
def test_explicit_loader_preserves_official_mapping_and_chemical_identity(models, official_mapper, reaction):
    actual = models[0].get_attention_guided_atom_maps([reaction])[0]
    reference = official_mapper.get_attention_guided_atom_maps([reaction])[0]
    assert actual["mapped_rxn"] == reference["mapped_rxn"]
    assert actual["confidence"] == pytest.approx(reference["confidence"], rel=1e-6, abs=1e-10)
    reactants, product = reaction.split(">>")
    evidence = validate_mapping(canonical_structure(reactants)[0], canonical_structure(product)[0],
                                actual["mapped_rxn"], actual["confidence"])
    assert evidence.mode_consistent


def test_five_mode_execution_does_not_reach_diskcache_or_training_paths(models):
    body = canonical_input(ImpurityInput(
        reactants=["CC(=O)Cl", "CN"], known_product="CNC(C)=O", solvents=["CO"], count=10,
    ))
    result = predict_impurities(body, models)
    assert result["execution"]["modes_completed"] == [1, 2, 3, 4, 5]
    assert result["execution"]["forward_calls"] > 0
    assert result["execution"]["mapping_calls"] > 0
    assert result["candidates"]
    assert not any(name.startswith("diskcache") for name in sys.modules)
    assert "rxn.utilities.caching" not in sys.modules
    assert "transformers.trainer" not in sys.modules
    assert "transformers.models.lightglue.modeling_lightglue" not in sys.modules
    assert "transformers.models.x_clip.convert_x_clip_original_pytorch_to_hf" not in sys.modules
    assert os.environ["HF_HUB_OFFLINE"] == os.environ["TRANSFORMERS_OFFLINE"] == "1"
    assert os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] == "1"


def test_actual_case_joint_ranking_beats_similarity_only_without_changing_origins(models):
    body = canonical_input(ImpurityInput(
        reactants=["CC(=O)Cl", "CN"], known_product="CNC(C)=O", solvents=["CO"], count=10,
    ))
    result = ImpurityResult.model_validate(predict_impurities(body, models))
    assert result.provenance.ranking_strategy == RANKING_STRATEGY
    ranks = [(origin_ranking_score(row.origins[0]), row.similarity_to_known_product) for row in result.candidates]
    assert ranks == sorted(ranks, reverse=True)
    similarity_first = max(result.candidates, key=lambda row: row.similarity_to_known_product)
    assert result.candidates[0].product != similarity_first.product
    assert origin_ranking_score(result.candidates[0].origins[0]) > origin_ranking_score(similarity_first.origins[0])
    for row in result.candidates:
        scores = [origin_ranking_score(origin) for origin in row.origins]
        assert scores == sorted(scores, reverse=True)
        assert row.mapping == row.origins[0].mapping
        for origin in row.origins:
            actual = validate_mapping(origin.reactants, row.product, origin.mapping.mapped_reaction,
                                      origin.mapping_confidence, [item.smiles for item in origin.required_fragments])
            assert actual == origin.mapping
