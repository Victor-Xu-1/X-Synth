"""Remove runtime filesystem details from public scientific evidence."""


def public_evidence(value):
    if isinstance(value, dict):
        return {
            key: public_evidence(item)
            for key, item in value.items()
            if key not in {"path", "repo_root", "run_dir"} and not key.endswith("_path")
        }
    if isinstance(value, list):
        return [public_evidence(item) for item in value]
    return value
