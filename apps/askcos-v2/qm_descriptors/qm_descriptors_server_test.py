import pytest
import requests


def test_call():
    url = "http://0.0.0.0:9602/qm_descriptors"
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
    assert len(result) == 38
    assert type(result.get("npa charge (e)")) == list
    assert len(result.get("npa charge (e)")) == 15


if __name__ == "__main__":
    pytest.main([__file__])
