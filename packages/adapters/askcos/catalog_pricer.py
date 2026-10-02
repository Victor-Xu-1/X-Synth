from packages.adapters.stock.stock_index import StockIndex


class CatalogPricer:
    """Native ASKCOS wire projection of the same exact product stock snapshot."""

    def __init__(self, path):
        self.index = StockIndex(path)

    def _record(self, matches, source=None):
        sources = [source] if isinstance(source, str) else source
        if sources and "unified_commercial" not in sources:
            matches = [row for row in matches if row["source"] in sources]
        if not matches:
            return None
        record = matches[0]
        return {
            "smiles": record["smiles"],
            "source": record["source"],
            "ppg": record["ppg"],
            "buyable": True,
            "price_known": record["ppg"] is not None,
            "properties": [
                {"link": record["url"]},
                {"catalog_id": record["catalog_id"]},
                {"buyable": True},
                {"stock_snapshot": self.index.summary["source_sha256"]},
            ],
        }

    def lookup_smiles(self, smiles, source=None):
        return self._record(self.index.lookup(smiles), source)

    def lookup_smiles_list(self, smiles_list, source=None):
        return {
            smiles: record
            for smiles, matches in self.index.lookup_many(smiles_list).items()
            if (record := self._record(matches, source)) is not None
        }
