import argparse
import os
from pathlib import Path
import secrets


def main():
    parser = argparse.ArgumentParser(description="Generate private local ASKCOS runtime credentials once")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    values = {
        "MONGO_INITDB_ROOT_USERNAME": "x_synth_runtime",
        "MONGO_INITDB_ROOT_PASSWORD": secrets.token_hex(32),
        "OAUTH2_SECRET_KEY": secrets.token_hex(48),
        "ASKCOS_ADMIN_USERNAME": "x_synth_admin",
        "ASKCOS_ADMIN_PASSWORD": secrets.token_hex(24),
    }
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        for key, value in values.items():
            handle.write(f"{key}={value}\n")
    print("Private runtime configuration generated; no credential values were displayed")


if __name__ == "__main__":
    main()
