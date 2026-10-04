import numpy as np
from configs import db_config
from pydantic import BaseModel
from pymongo import errors, MongoClient
from rdkit import Chem
from schemas.base import LowerCamelAliasModel
from typing import Any
from utils import register_util
from utils.similarity_search_utils import sim_search, sim_search_aggregate
from pymongo import timeout as mongo_timeout
from packages.adapters.askcos.references import (
    MAX_CANDIDATES,
    SOURCE,
    ReferenceError,
    ReferenceSearchInput,
    ReferenceSearchResponse,
    ReferenceStatus,
    canonical_reference_query,
    parse_reference_reaction,
    product_recall_key,
    reference_search_response,
)

DEFAULT_MORGAN_RADIUS = 2
DEFAULT_MORGAN_LEN = 2048


class ReactionsInput(LowerCamelAliasModel):
    ids: list[int | str]
    template_set: str | None = None


class ReactionsResponse(BaseModel):
    reactions: list


def _bits_to_array(bits: list[int], fp_size: int = 2048) -> np.ndarray:
    bits_array = np.zeros(fp_size, dtype=np.bool_)
    for bit in bits:
        bits_array[bit] = True

    return bits_array


@register_util(name="reactions")
class Reactions:
    """Util class for Reactions"""
    prefixes = ["reactions"]
    methods_to_bind: dict[str, list[str]] = {
        "post": ["POST"],
        "search_reaction_id": ["POST"],
        "lookup_by_exact_product_smiles": ["POST"],
        "lookup_similar_smiles": ["POST"]
    }

    def __init__(self, util_config: dict[str, Any]):
        self.client = MongoClient(serverSelectionTimeoutMS=1000, **db_config.MONGO)
        database = "askcos"
        collection = "reactions"
        # only products with valid reaction_smarts are kept in mol_collection
        mol_collection = "products_in_reactions"
        count_collection = "fp_counts_in_reactions"

        try:
            self.client.server_info()
        except errors.ServerSelectionTimeoutError:
            raise ValueError("Cannot connect to mongodb for reactions")
        else:
            self.db = self.client[database]
            self.collection = self.db[collection]
            self.mol_collection = self.db[mol_collection]
            self.count_collection = self.db[count_collection]

    def lookup_by_exact_product_smiles(
        self,
        smiles: str,
        reaction_set: str = "USPTO_FULL"
    ) -> list[str]:
        """
        Lookup molecule entries (extracted from the reaction database) by exact match

        Returns:
            A list of reaction ids
        """

        mol = Chem.MolFromSmiles(smiles)
        if not mol:
            return []

        # proper canonicalization by removing atom mapping first
        for a in mol.GetAtoms():
            a.ClearProp("molAtomMapNumber")
            a.SetIsotope(0)

        canonical_smiles = Chem.MolToSmiles(mol)

        query = {
            "product_smiles": canonical_smiles,
            "template_set": reaction_set
        }
        cursor = self.mol_collection.find(query)
        reaction_ids = [str(mol["_id"]) for mol in cursor]

        return reaction_ids

    def lookup_similar_smiles(
        self,
        smiles: str,
        sim_threshold: float = 0.3,
        reaction_set: str = "USPTO_FULL",
        method: str = "accurate"
    ) -> list:
        """
        Lookup molecules in the database based on tanimoto similarity to the input
        SMILES string

        Note: assumes that a Mol Object, and Morgan Fingerprints are stored for
            each SMILES entry in the database

        Returns:
            A list of dictionary with one database entry for each molecule match including
            the tanimoto similarity to the query

        Note:
            Currently there are two options implemented lookup methods.
            The 'accurate' method is based on an aggregation pipeline in Mongo.
            The 'fast' method uses locality-sensitive hashing to greatly improve
            the lookup speed, at the cost of accuracy (especially at lower
            similarity thresholds).
        """
        query_mol = Chem.MolFromSmiles(smiles)
        if not query_mol:
            return []

        if method == "accurate":
            results = sim_search_aggregate(
                mol=query_mol,
                mol_collection=self.mol_collection,
                count_collection=self.count_collection,
                threshold=sim_threshold,
                reaction_set=reaction_set
            )
        elif method == "naive":
            results = sim_search(
                mol=query_mol,
                mol_collection=self.mol_collection,
                count_collection=self.count_collection,
                threshold=sim_threshold,
                reaction_set=reaction_set
            )
        elif method == "fast":
            raise NotImplementedError
        else:
            raise ValueError(f"Similarity search method '{method}' not implemented")

        output = [{'smiles': i['product_smiles'], 'tanimoto': i['tanimoto'], 'id': i['_id']} for i in results]

        return output

    def search_reaction_id(
        self,
        id: str,
        reaction_set: str = "USPTO_FULL"
    ) -> dict:
        """
        Lookup reaction collection using id.

        Returns:
            A dictionary containing document of reaction 
        """
        return self.collection.find_one({'_id': id, "template_set": reaction_set})

    def uspto_exact_references(
        self, data: ReferenceSearchInput
    ) -> ReferenceSearchResponse:
        return UsptoReferenceQueries(self).search(data)

    def uspto_reference_status(self) -> ReferenceStatus:
        return UsptoReferenceQueries(self).status()

    def post(self, data: ReactionsInput) -> ReactionsResponse:
        query = {"reaction_id": {"$in": data.ids}}
        if data.template_set:
            # Processing for template subsets which use the same historian data
            query["template_set"] = data.template_set.split(":")[0]

        reactions_by_ids = list(self.collection.find(query))
        resp = ReactionsResponse(reactions=reactions_by_ids)

        return resp


REFERENCE_PROJECTION = {
    "_id": 1,
    "template_set": 1,
    "reaction_smiles": 1,
    "patent_number": 1,
    "paragraph_num": 1,
    "year": 1,
    "text_mined_yield": 1,
    "calculated_yield": 1,
}
REFERENCE_MAX_TIME_MS = 3000
# These bounds are internal source IDs, never user-controlled regex or collections.
USPTO_SOURCE_RANGE = {
    "_id": {"$gte": "USPTO_FULL_", "$lt": "USPTO_FULL`"},
    "template_set": SOURCE,
}


def _reference_index(collection, field: str, reason: str) -> str:
    for name, definition in collection.index_information().items():
        keys = definition.get("key", [])
        if (
            keys
            and keys[0][0] == field
            and keys[0][1] in {1, -1}
            and not definition.get("partialFilterExpression")
            and not definition.get("hidden")
            and definition.get("collation", {}).get("locale", "simple") == "simple"
        ):
            return name
    raise ReferenceError(reason)


def _reference_find(
    collection, query: dict, projection: dict, *, index: str, limit: int
) -> list[dict]:
    if not 1 <= limit <= MAX_CANDIDATES:
        raise ValueError("Reference cursor exceeds the candidate budget")
    cursor = (
        collection.find(query, projection)
        .hint(index)
        .max_time_ms(REFERENCE_MAX_TIME_MS)
        .limit(limit)
    )
    with cursor:
        return list(cursor)


def _reference_count(
    collection, query: dict, *, index: str, limit: int | None = None
) -> int:
    options = {"hint": index, "maxTimeMS": REFERENCE_MAX_TIME_MS}
    if limit is not None:
        options["limit"] = limit
    return collection.count_documents(query, **options)


def _reference_database_error(exc: errors.PyMongoError) -> ReferenceError:
    timed_out = (
        isinstance(exc, (errors.ExecutionTimeout, errors.NetworkTimeout)) or exc.timeout
    )
    return ReferenceError(
        "reference_query_timeout" if timed_out else "reference_database_unavailable"
    )


class UsptoReferenceQueries:
    """Read-only USPTO access with forced indexes and a total three-second deadline."""

    def __init__(self, reactions: Reactions):
        self.records = reactions.collection
        self.products = reactions.mol_collection

    def _indexes(self) -> tuple[str, str, str]:
        product = _reference_index(
            self.products, "product_smiles", "reference_product_index_unavailable"
        )
        records = _reference_index(
            self.records, "_id", "reference_record_index_unavailable"
        )
        product_ids = _reference_index(
            self.products, "_id", "reference_product_index_unavailable"
        )
        return product, records, product_ids

    def _source_count(self, record_index: str) -> int | None:
        # Without a source-leading index, prove existence without counting a whole source.
        try:
            source_index = _reference_index(
                self.records,
                "template_set",
                "reference_record_index_unavailable",
            )
        except ReferenceError:
            if (
                _reference_count(
                    self.records, USPTO_SOURCE_RANGE, index=record_index, limit=1
                )
                == 0
            ):
                raise ReferenceError("reference_records_unavailable")
            return None
        count = _reference_count(
            self.records, {"template_set": SOURCE}, index=source_index
        )
        if count == 0:
            raise ReferenceError("reference_records_unavailable")
        return count

    def _verify_source(self, indexes: tuple[str, str, str]) -> int | None:
        product_index, record_index, product_ids = indexes
        count = self._source_count(record_index)
        products = _reference_find(
            self.products,
            USPTO_SOURCE_RANGE,
            {"_id": 1, "product_smiles": 1},
            index=product_ids,
            limit=1,
        )
        if not products:
            raise ReferenceError("reference_product_index_inconsistent")
        sample = products[0]
        records = _reference_find(
            self.records,
            {"_id": sample["_id"], "template_set": SOURCE},
            REFERENCE_PROJECTION,
            index=record_index,
            limit=1,
        )
        if not records:
            raise ReferenceError("reference_records_unavailable")
        try:
            _, original_products, _ = parse_reference_reaction(
                records[0].get("reaction_smiles")
            )
            original_product = canonical_reference_query(
                ReferenceSearchInput(product=".".join(original_products))
            ).product
        except (ValueError, RuntimeError, TypeError) as exc:
            raise ReferenceError("reference_record_invalid") from exc
        recall = product_recall_key(original_product)
        if recall != sample.get("product_smiles") or not _reference_find(
            self.products,
            {"product_smiles": recall, "_id": sample["_id"], "template_set": SOURCE},
            {"_id": 1},
            index=product_index,
            limit=1,
        ):
            raise ReferenceError("reference_product_index_inconsistent")
        return count

    def status(self) -> ReferenceStatus:
        product_index_available = False
        try:
            with mongo_timeout(REFERENCE_MAX_TIME_MS / 1000):
                indexes = self._indexes()
                product_index_available = True
                count = self._verify_source(indexes)
                return ReferenceStatus(
                    ready=True, product_index_available=True, record_count=count
                )
        except errors.PyMongoError as exc:
            reason = _reference_database_error(exc).code
        except ReferenceError as exc:
            reason = exc.code
        except (ValueError, RuntimeError, KeyError, TypeError):
            reason = "reference_record_invalid"
        return ReferenceStatus(
            ready=False, product_index_available=product_index_available, reason=reason
        )

    def search(self, data: ReferenceSearchInput) -> ReferenceSearchResponse:
        query = canonical_reference_query(data)
        try:
            with mongo_timeout(REFERENCE_MAX_TIME_MS / 1000):
                indexes = self._indexes()
                product_index, record_index, _ = indexes
                self._verify_source(indexes)
                recall_query = {
                    "product_smiles": product_recall_key(query.product),
                    "template_set": SOURCE,
                }
                count = _reference_count(
                    self.products,
                    recall_query,
                    index=product_index,
                    limit=MAX_CANDIDATES + 1,
                )
                if count > MAX_CANDIDATES:
                    raise ReferenceError("reference_candidate_budget_exceeded")
                if count == 0:
                    return reference_search_response([], query, limit=data.limit)
                candidates = _reference_find(
                    self.products,
                    recall_query,
                    {"_id": 1},
                    index=product_index,
                    limit=count,
                )
                identifiers = [item["_id"] for item in candidates]
                if len(identifiers) != count or any(
                    not isinstance(item, str) for item in identifiers
                ):
                    raise ReferenceError("reference_product_index_inconsistent")
                records = _reference_find(
                    self.records,
                    {"_id": {"$in": identifiers}, "template_set": SOURCE},
                    REFERENCE_PROJECTION,
                    index=record_index,
                    limit=count,
                )
                if len(records) != count:
                    raise ReferenceError("reference_records_unavailable")
            return reference_search_response(records, query, limit=data.limit)
        except errors.PyMongoError as exc:
            raise _reference_database_error(exc) from exc
