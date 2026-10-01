import pytest
import requests

# start the server with
# docker build -f Dockerfile_fastsolv_cpu -t fastsolv_cpu_test .
# docker run --name fastsolv -p 9711:9711 -t fastsolv_cpu_test


def test_call():
    url = "http://0.0.0.0:9761/fastsolv"
    data = dict(
        solvent_smiles=["CO", "CO", "CCO", "CCO"],
        solute_smiles=["CC(=O)Nc1ccc(O)cc1", "CC(=O)Nc1ccc(O)cc1", "CC(=O)Nc1ccc(O)cc1", "CC(=O)Nc1ccc(O)cc1"],
        temperature=[298.0, 340.0, 312.0, 270.0],
    )
    resp = requests.post(url, json=data)

    assert resp.status_code == 200
    resp = resp.json()
    assert resp["status"] == "SUCCESS"
    result = resp["results"][0]
    assert isinstance(result["predicted_logS"], float)
    assert result["predicted_logS_stdev"] > 0.0


if __name__ == "__main__":
    pytest.main([__file__])
