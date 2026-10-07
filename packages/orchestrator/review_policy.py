"""One authority for downstream qualification, independent of search inputs."""

REVIEW_POLICY = "exact_stock_graph2smiles_pinned_record_family_queue_v4"
FORWARD_REVIEW_POLICIES = {
    "exact_stock_graph2smiles_references_target_bond_families_v2",
    "exact_stock_graph2smiles_connected_dag_family_queue_v3", REVIEW_POLICY,
}
PREVIOUS_REVIEW_POLICY = "exact_stock_template_reconstruction_target_bond_families_v1"


def upgrade_review_checkpoint(checkpoint: dict, identity: dict) -> dict:
    previous = checkpoint.get("review_policy")
    if previous in FORWARD_REVIEW_POLICIES | {PREVIOUS_REVIEW_POLICY}:
        checkpoint = {**checkpoint, "review_policy": REVIEW_POLICY}
    bootstrap = set(checkpoint) == {"result_artifact_schema"} and (
        type(checkpoint["result_artifact_schema"]) is int
        and checkpoint["result_artifact_schema"] == 1
    )
    if checkpoint and not bootstrap and any(checkpoint.get(key) != value for key, value in identity.items()):
        raise ValueError("Checkpoint inputs or inventory changed")
    return {**identity, **checkpoint}
