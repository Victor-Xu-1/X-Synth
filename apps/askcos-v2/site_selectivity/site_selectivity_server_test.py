import pytest
import requests


def test_call():
    url = "http://0.0.0.0:9601/site_selectivity"
    data = {
        "smiles": [
            "Cc1ccccc1"
        ]
    }
    resp = requests.post(url, json=data)

    assert resp.status_code == 200
    resp = resp.json()
    assert resp["status"] == "SUCCESS"
    result = resp["results"][0]
    assert len(result) == 123
    assert type(result[0]) == dict
    assert len(result[0].get("atom_scores")) == 7


if __name__ == "__main__":
    pytest.main([__file__])
