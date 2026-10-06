"""One authority for downstream qualification, independent of search inputs."""

REVIEW_POLICY = "exact_stock_graph2smiles_references_target_bond_families_v2"
PREVIOUS_REVIEW_POLICY = "exact_stock_template_reconstruction_target_bond_families_v1"


def upgrade_review_checkpoint(checkpoint: dict, identity: dict) -> dict:
    previous = checkpoint.get("review_policy")
    if previous == PREVIOUS_REVIEW_POLICY:
        checkpoint = {**checkpoint, "review_policy": REVIEW_POLICY}
    if checkpoint and any(checkpoint.get(key) != value for key, value in identity.items()):
        raise ValueError("Checkpoint inputs or inventory changed")
    return {**identity, **checkpoint}
