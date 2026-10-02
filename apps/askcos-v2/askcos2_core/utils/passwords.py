"""Existing bcrypt hashes remain valid without an unmaintained password wrapper."""
import bcrypt


def hash_password(password: str) -> str:
    encoded = password.encode("utf-8")
    if not 1 <= len(encoded) <= 72:
        raise ValueError("Passwords must contain between 1 and 72 UTF-8 bytes")
    return bcrypt.hashpw(encoded, bcrypt.gensalt(rounds=12)).decode("ascii")


def verify_password(password: str, hashed: str) -> bool:
    encoded = password.encode("utf-8")
    if not 1 <= len(encoded) <= 72:
        return False
    try:
        return bcrypt.checkpw(encoded, hashed.encode("ascii"))
    except (ValueError, UnicodeError):
        return False
