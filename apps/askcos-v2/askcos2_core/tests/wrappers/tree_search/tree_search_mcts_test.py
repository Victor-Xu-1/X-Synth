import json
import os
import requests
import time
import unittest

V2_HOST = os.environ.get("V2_HOST", "http://0.0.0.0")
V2_PORT = os.environ.get("V2_PORT", "9100")


class RoutePublicationPackageTest(unittest.TestCase):
    """Pure route-publication contract tests for selected ASKCOS route trees."""

    def selected_route_payload(self):
        return {
            "data_mode": "simulation",
            "generation_style": "publication",
            "target_smiles": "Oc1ccc(F)cc1",
            "route_index": 0,
            "result_id": "tree-result-1",
            "comparison_routes": [
                {"route_index": 1, "metrics": {"num_reactions": 2, "score": 0.62}},
            ],
            "selected_route": {
                "graph": {"num_reactions": 1, "score": 0.81},
                "nodes": [
                    {"id": "target", "type": "chemical", "smiles": "Oc1ccc(F)cc1"},
                    {
                        "id": "reaction-1",
                        "type": "reaction",
                        "smiles": "Fc1ccc(Br)cc1.O>>Oc1ccc(F)cc1",
                    },
                ],
                "edges": [{"id": "edge-1", "from": "target", "to": "reaction-1"}],
            },
        }

    def test_publication_package_exposes_experiment_template_and_comparison_routes(self):
        from utils.tree_search_results import build_route_publication_package

        package = build_route_publication_package(self.selected_route_payload())

        self.assertFalse(package["publishable"])
        self.assertEqual(package["comparison_routes"][0]["route_index"], 1)
        self.assertIn("experimental_data_template", package)
        self.assertEqual(
            package["experimental_data_template"]["step_records"][0]["step"],
            1,
        )
        self.assertIn("reaction_conditions", package["missing_required_fields"])
        self.assertEqual(package["export_contract"]["formats"], ["markdown", "json"])

    def test_publication_document_assembles_markdown_from_entered_data_only(self):
        from utils.tree_search_results import (
            assemble_route_publication_document,
            build_route_publication_package,
        )

        package = build_route_publication_package(self.selected_route_payload())
        document = assemble_route_publication_document({
            "package": package,
            "section_drafts": [
                {"key": "title", "title": "Title", "content": "Route-linked test dossier"},
                {"key": "abstract", "title": "Abstract", "content": "A route-linked test package was prepared."},
            ],
            "experimental_data": {
                "reaction_conditions": "User-entered test condition record.",
                "isolated_yield": "User-entered yield field for test validation.",
                "hrms_or_lcms": "User-entered LCMS placeholder.",
                "nmr_records": [
                    {
                        "source_type": "entered",
                        "nucleus": "1H",
                        "frequency_mhz": 400,
                        "solvent": "CDCl3",
                        "peaks": [
                            {
                                "shift": "7.12",
                                "multiplicity": "d",
                                "j_hz": "8.4",
                                "integration": "1H",
                            }
                        ],
                    }
                ],
            },
        })

        self.assertFalse(document["publishable"])
        self.assertEqual(document["missing_required_fields"], [])
        self.assertIn("Route-linked test dossier", document["markdown"])
        self.assertIn("User-entered test condition record.", document["markdown"])
        self.assertIn("1H NMR (400 MHz, CDCl3):", document["markdown"])
        self.assertNotIn("[SIMULATED TEST DATA", document["nmr_texts"][0])


class RetroATTest(unittest.TestCase):
    """Test class for Retro Augmented Transformer wrapper"""

    @classmethod
    def setUpClass(cls) -> None:
        """This method is run once before all tests in this class."""
        cls.session = requests.Session()
        cls.base_url = f"{V2_HOST}:{V2_PORT}/api"
        cls.module_url = f"{V2_HOST}:{V2_PORT}/api/tree-search/mcts"

    def get_async_result(self, task_id: str, timeout: int = 20):
        """Retrieve celery task output"""
        # Try to get result 10 times in per sec interval
        for _ in range(timeout):
            response = self.session.get(
                f"{self.base_url}/celery/task/get?task_id={task_id}",
            )
            response = response.json()
            if response.get("complete"):
                return response
            else:
                if response.get("failed"):
                    print("Celery task failed!")

                    return response
                else:
                    time.sleep(1)
        else:
            print("Celery task timeout!")

            return response

    def test_1(self):
        case_file = "tests/wrappers/tree_search/tree_search_mcts_test_case_1.json"
        with open(case_file, "r") as f:
            data = json.load(f)

        # get sync response
        response_sync = self.session.post(
            f"{self.module_url}/call-sync-without-token", json=data
        ).json()

        # only check sync, as async endpoint typically requires authentication
        for response in [response_sync]:
            self.assertEqual(response["status_code"], 200)
            self.assertIsInstance(response["result"], dict)
            self.assertIsInstance(response["result"]["stats"], dict)
            self.assertIsInstance(response["result"]["paths"], list)
            self.assertIsInstance(response["result"]["graph"], dict)
            self.assertEqual(response["result"]["version"], 2)
