from pymongo import MongoClient

from configs import db_config
from utils.mongo_wait import wait_for_mongodb


def test_wait_for_mongodb_accepts_current_askcos_mongo():
    client = MongoClient(serverSelectionTimeoutMS=1000, **db_config.MONGO)

    wait_for_mongodb(client, timeout_seconds=3, interval_seconds=0.2)
