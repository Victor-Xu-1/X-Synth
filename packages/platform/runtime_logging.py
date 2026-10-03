"""Bounded product logging, independent of the launching terminal."""

from pathlib import Path


def product_log_config(state: Path) -> dict:
    directory = state.resolve() / "logs"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "runtime": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"}
        },
        "handlers": {
            "runtime": {
                "class": "logging.handlers.RotatingFileHandler",
                "filename": str(directory / "product.log"),
                "maxBytes": 5 * 1024 * 1024,
                "backupCount": 3,
                "encoding": "utf-8",
                "formatter": "runtime",
            }
        },
        "root": {"level": "INFO", "handlers": ["runtime"]},
        "loggers": {
            name: {"level": "INFO", "handlers": [], "propagate": True}
            for name in ("uvicorn", "uvicorn.error", "uvicorn.access")
        },
    }
