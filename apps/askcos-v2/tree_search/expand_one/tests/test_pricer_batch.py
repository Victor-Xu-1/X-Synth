from expand_one_controller import _prefetch_exact_fragment_prices


class RecordingPricer:
    def __init__(self):
        self.calls = []

    def lookup_many(self, smiles_list, canonicalize=False):
        self.calls.append((smiles_list, canonicalize))
        return {"CCO": (12.5, "catalog")}


def test_prefetch_exact_fragment_prices_deduplicates_one_batch():
    pricer = RecordingPricer()
    cache = {}

    _prefetch_exact_fragment_prices(
        ["CCO.CN", "CCO"],
        use_smarts=False,
        price_client=pricer,
        cache=cache,
    )

    assert pricer.calls == [(["CCO", "CN"], False)]
    assert cache == {
        "CCO": (12.5, "catalog", ""),
        "CN": (0.0, "", ""),
    }


def test_prefetch_exact_fragment_prices_defers_abstract_groups_to_smarts():
    pricer = RecordingPricer()
    cache = {}

    _prefetch_exact_fragment_prices(
        ["CCO.[1CH3]N"],
        use_smarts=True,
        price_client=pricer,
        cache=cache,
    )

    assert pricer.calls == [(["CCO"], False)]
    assert "[1CH3]N" not in cache
