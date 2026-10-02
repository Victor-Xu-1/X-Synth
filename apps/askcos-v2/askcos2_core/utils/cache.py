import json
import hashlib
import os
from datetime import datetime, timedelta, timezone
from configs import db_config
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel
from pymongo import errors, MongoClient
from typing import Any
from utils import register_util


@register_util(name="cache_controller")
class CacheController:
    """Content-addressed, asset-scoped responses without destructive startup resets."""
    prefixes = []
    methods_to_bind: dict[str, list[str]] = {}

    def __init__(self, util_config: dict[str, Any] | None = None):
        self.client = MongoClient(serverSelectionTimeoutMS=2000, **db_config.MONGO)
        self.client.admin.command("ping")
        self.collection = self.client["cache"]["x_synth_responses"]
        self.collection.create_index("expires", expireAfterSeconds=0)
        self.scope = os.environ.get("X_SYNTH_ASSET_IDENTITY", "native-unconfigured")

    def key(self, module_name, input):
        payload = [self.scope, module_name, jsonable_encoder(input)]
        return hashlib.sha256(json.dumps(payload, sort_keys=True, allow_nan=False).encode()).hexdigest()

    def get(self, module_name: str, input: BaseModel) -> dict:
        record = self.collection.find_one({"_id": self.key(module_name, input), "expires": {"$gt": datetime.now(timezone.utc)}})
        if record is None:
            raise KeyError("Cache miss")
        return record["response"]

    def add(self, module_name: str, input: BaseModel, response: BaseModel) -> None:
        self.collection.update_one(
            {"_id": self.key(module_name, input)},
            {"$set": {"response": response.model_dump(), "expires": datetime.now(timezone.utc) + timedelta(days=7)}},
            upsert=True,
        )
