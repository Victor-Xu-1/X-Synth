from pathlib import Path

from packages.knowledge_base.template_library import infer_template_source_name


def test_model_local_template_files_retain_their_distinct_namespaces():
    first = Path("models/pistachio/templates.jsonl")
    second = Path("models/pistachio_ringbreaker/templates.jsonl")
    assert infer_template_source_name(first) == "pistachio"
    assert infer_template_source_name(second) == "pistachio_ringbreaker"
