import tensorflow as tf

import db, utils


class ReactionClass:
    """
    Reaction classification model::

        MetaGraphDef with tag-set: 'serve' contains the following SignatureDefs:
        signature_def['serving_default']:
        The given SavedModel SignatureDef contains the following input(s):
            inputs['input'] tensor_info:
                dtype: DT_STRING
                shape: (-1)
                name: serialized_example:0
        The given SavedModel SignatureDef contains the following output(s):
            outputs['predictions'] tensor_info:
                dtype: DT_INT32
                shape: (-1)
                name: loss/ArgMax:0
            outputs['probabilities'] tensor_info:
                dtype: DT_FLOAT
                shape: (-1, 1003)
                name: loss/Softmax:0
        Method name is: tensorflow/serving/predict
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.imported = None
        self.imported_function = None

    def load_model(self, model_path=db.MODEL_PATH):
        """
        Load reaction classification model from the specified path.
        """
        self.imported = tf.saved_model.load(export_dir=model_path, tags="serve")
        self.imported_function = self.imported.signatures["serving_default"]

    def smiles_to_input(self, smiles):
        """
        Convert reaction SMILES to input string.
        """
        return utils.featurize_smiles(smiles)

    def preprocess(self, smiles_list):
        """
        Process list of input reaction SMILES.

        If a reaction cannot be processed, it will be excluded from the returned
        ``input_list``. To enable locating each item from ``smiles_list`` in
        ``input_list``, the returned ``input_indices`` is a list containing the
        corresponding index in `input_list` for each element of `smiles_list`,
        and ``None`` if the item failed processing.

        Args:
            smiles_list (list[str]): list of reaction SMILES to process

        Returns:
            input_list (list): list of successfully processed inputs
            input_indices (list): index of each input reaction in the output
        """
        if not isinstance(smiles_list, list):
            smiles_list = [smiles_list]

        input_indices = []
        input_list = []
        for i, smi in enumerate(smiles_list):
            try:
                input_item = self.smiles_to_input(smi)
            except Exception:
                # Unable to be transformed into valid input, possibly because of tokens that were not in the vocab file
                input_indices.append(None)
                continue
            else:
                input_indices.append(len(input_list))
                input_list.append(input_item)

        return input_list, input_indices

    def postprocess(self, predictions, num_results=5, input_indices=None):
        """
        Decode predicted probabilities from reaction classification model.

        If ``input_indices`` is provided, pad the result list with null results
        to match the original input list.

        Args:
            predictions (list): list of predictions from the model
            num_results (int, optional): top N classes to keep for each result
            input_indices (list, optional): index map for original input

        Returns:
            list: top class predictions as dicts
        """
        null_result = {
            "status": "FAILED",
            "message": "Unable to Tokenize SMILES",
            "result": [
                {
                    "rank": -1,
                    "reaction_num": "0.0.0",
                    "reaction_name": "Unknown",
                    "reaction_classnum": "0.0",
                    "reaction_classname": "Unknown",
                    "reaction_superclassnum": "0",
                    "reaction_superclassname": "Unknown",
                    "prediction_certainty": 0,
                }
            ]
            * num_results,
        }
        results = [
            utils.decode_output(pred["probabilities"], num_results=num_results)
            for pred in predictions
        ]
        if input_indices is not None:
            results = [
                results[i] if i is not None else null_result for i in input_indices
            ]
        return results

    def evaluate(self, input_list):
        """
        Run model evaluation the loaded reaction classification model.

        Args:
            input_list (list): list of processed model inputs

        Returns:
            list: result dicts containing 'predictions' and 'probabilities'
        """
        if not self.imported_function:
            self.load_model()

        inputs = tf.convert_to_tensor(input_list, dtype=tf.string)
        y_pred = self.imported_function(inputs)

        return [
            {"predictions": pred, "probabilities": prob}
            for pred, prob in zip(
                y_pred["predictions"].numpy().tolist(),
                y_pred["probabilities"].numpy().tolist(),
            )
        ]

    def predict(self, smiles_list, num_results=5):
        """
        Predict top reaction classes for each of the input reaction SMILES.

        Args:
            smiles_list (list[str]): list of reaction SMILES to classify
            num_results (int, optional): number of predictions to return

        Returns:
            list: top class predictions as dicts
        """
        input_list, input_indices = self.preprocess(smiles_list)
        if input_list:
            result = self.evaluate(input_list)
        else:
            result = []
        return self.postprocess(
            result, num_results=num_results, input_indices=input_indices
        )

    def get_classes(self, rxnsmiles, num_results=5):
        """
        Return class predictions for the input reaction.

        Wrapper around ``predict`` method for a single reaction.

        Args:
            rxnsmiles (str): reaction SMILES to classify
            num_results (int, optional): number of predictions to return

        Returns:
            dict: top N=num_results class predictions
        """
        return self.predict([rxnsmiles], num_results=num_results)[0]

    def get_top_class_batch(self, smiles_list, level=2, threshold=None):
        """
        Return the top reaction class prediction for the input reactions.

        Level can be specified to choose the specificity of the returned name:
            - 1: reaction superclass name
            - 2: reaction class name
            - 3: reaction name

        Args:
            smiles_list (list): list of reaction SMILES to classify
            level (int, optional): reaction name level to return
            threshold (float, optional): minimum confidence for predicted class

        Returns:
            list: top predicted reaction class ID and name as tuples
        """
        results = self.predict(smiles_list, num_results=1)

        level_prefix = {
            1: "reaction_superclass",
            2: "reaction_class",
            3: "reaction_",
        }[level]
        unknown_num = {
            1: "0",
            2: "0.0",
            3: "0.0.0",
        }[level]

        output = []
        for result in results:
            top = result["result"][0]
            if threshold is not None and top["prediction_certainty"] < threshold:
                output.append((unknown_num, "Unknown"))
            else:
                output.append((top[level_prefix + "num"], top[level_prefix + "name"]))

        return output

    def get_top_class(self, rxnsmiles, level=2, threshold=None):
        """
        Return the top reaction class prediction for the input reaction.

        Wrapper around ``get_top_class_batch`` method for a single reaction.

        Level can be specified to choose the specificity of the returned name:
            - 1: reaction superclass name
            - 2: reaction class name
            - 3: reaction name

        Args:
            rxnsmiles (str): reaction SMILES to classify
            level (int, optional): reaction name level to return
            threshold (float, optional): minimum confidence for predicted class

        Returns:
            (str, str): top predicted reaction class ID and name
        """
        return self.get_top_class_batch([rxnsmiles], level=level, threshold=threshold)[
            0
        ]


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Classify reactions.")
    parser.add_argument(
        "rxnsmiles",
        metavar="SMILES",
        type=str,
        nargs="?",
        help="reaction SMILES to classify",
    )
    args = parser.parse_args()

    model = ReactionClass()
    model.load_model()
    num_results = 10

    if not args.rxnsmiles:
        test_reactions = [
            ("CC=CC>>CCCC", "hydrogenation", ["7.6.1"]),
            ("ClCCC>>C=CC", "SN2 elimination", ["9.7.254"]),
            ("CC=CC>>CC(O)C(C)O", "dihydroxylation", ["10.4.9", "10.4.11"]),
            (
                "CCC(C)O>>CCC(C)=O",
                "oxidation",
                ["8.1.5", "8.1.3", "8.1.10", "8.1.7", "8.1.15"],
            ),
            ("CCC(C)=O>>CCC(C)O", "reduction", ["7.5.1", "7.5.2", "7.5.5"]),
            (
                "CC(O)CCCCC(O)CC>>CC(=O)CCCCC(=O)CC",
                "oxidation",
                ["8.1.5", "8.1.3", "8.1.10", "8.1.7", "8.1.15"],
            ),
            ("CC=CC>>CC=O", "ozonolysis", ["8.5.1", "8.5.2"]),
            ("CCO.CCBr>>CCOCC.Br", "williamson ether", ["1.7.9"]),
            ("CC=CC>>CC(O)CC", "hydration", ["10.4.3"]),
            ("CC=CC>>CC(Br)CC", "hydrohalogenation", ["10.1.8"]),
            ("CC=CC>>CC(Br)C(Br)C", "dihalogenation", ["10.1.6"]),
            ("COC=CC=C.C=CC#N>>COC1C=CCCC1(C#N)", "diels alder", ["3.11.3"]),
            ("c1ccccc1.CC(=O)Cl>>c1ccccc1C(=O)C.Cl", "freidel crafts", ["3.10.1"]),
            ("CC(=O)N=[N+]=N>>CNC(=O)OC", "curtius rearrangement", ["2.4.1"]),
            (
                "CCOC(=O)c1ccccc1.CC(=O)c1ccccc1>>O=C(CC(=O)c1ccccc1)c1ccccc1.CCO",
                "clasisen condensation",
                ["3.11.41"],
            ),
            ("CCCCl>>C=CC", "SN2 elimination", ["9.7.254"]),
            ("CC#CC>>CC=CC", "alkyne hydrogenation 1", ["7.9.8"]),
            (r"CC#CC>>C/C=C\C", "alkyne hydrogenation 2", ["7.9.8"]),
            (
                "CC=C(C)C>>CC(C)C(C)C=O",
                "hydroformylation",
                ["8.7.4", "3.9.34", "10.4.1"],
            ),
            ("C[C-](C)[N+](=O)[O-]>>CC(C)=O", "nef", ["9.7.89"]),
            ("C=[N+]=[N-].CC=CC>>C1CC1", "cyclopropanation", ["3.11.57"]),
            (
                "O=C(O)C1CCCCC1.C[N+]#N>>COC(=O)C1CCCCC1.N#N",
                "diazomethane methylesterification",
                ["1.7.2", "1.7.6"],
            ),
            ("CC(C)CC=O.CC[Mg]Br>>CCC(O)CC(C)C", "bromo grignard", ["3.7.2"]),
            ("CC(=O)CC(C)C.CC[Mg]Br>>CCC(C)(O)CC(C)C", "bromo grignard 2", ["3.7.2"]),
            ("O=C1CCCC1>>O=C1OCCCC1", "baeyer villager", ["2.6.4"]),
            ("COc1ccccc1>>COC1=CCC=CC1", "birch reduction", ["7.9.15"]),
            (
                "CCc1ccc(Cl)cc1.Nc1ccccc1>>CCc2ccc(Nc1ccccc1)cc2",
                "buchwald-hartwig",
                ["1.3.2", "1.3.7"],
            ),
            ("CC(=O)c1ccccc1>>CCc1ccccc1", "clemmensen reduction", ["7.9.4", "7.9.6"]),
            (
                "CC(=O)c1ccccc1>>OC(=O)c1ccccc1",
                "haloform reaction",
                ["9.7.240", "9.7.241"],
            ),
            ("O=C(O)Cc1ccccc1>>O=C(O)C(Br)c1ccccc1", "HVZ bromination", ["10.1.1"]),
            ("NC(=O)c1ccccc1>>Nc1ccccc1", "hoffman rearrangement", ["9.7.70"]),
            (
                "CCOC(=O)CC(=O)OCC.CCC(C)=O>>CCC(C)=CC(=O)O",
                "knovengal condensation",
                ["3.11.34"],
            ),
            ("C=O.CNC.CCC(=O)CC>>CCC(=O)C(C)CN(C)C", "mannich", ["3.11.6"]),
            (
                "CC(=O)CC(C)=O.C=CC(=O)OCC>>CCOC(=O)CCC(C(C)=O)C(C)=O",
                "michael addition",
                ["3.11.76"],
            ),
            (
                "CC(O)C.OC(=O)CC>>CC(OC(=O)CC)C",
                "esterification",
                ["2.6.2", "2.6.9", "2.6.3"],
            ),
            (
                "CN(C)c1ccccc1.O=CN(C)C>>CN(C)c1ccc(C=O)cc1",
                "vilsimer-haack/formylation",
                ["3.11.14", "10.4.1"],
            ),
        ]

        aux_data = db.get_aux_data()
        n = 0
        correct = 0
        low_acc = 0
        for smiles, target_class_name, target_class_nums in test_reactions:
            n += 1
            results = model.get_classes(smiles, num_results=num_results)["result"]
            print("smiles: ", smiles)
            print("target class name: ", target_class_name)
            for i, result in enumerate(results):
                num = result["reaction_num"]
                name = result["reaction_name"]
                prob = result["prediction_certainty"]
                if result["rank"] == 1 and num in target_class_nums:
                    correct += 1
                    if prob < 0.35:
                        print(
                            f"\033[93mLow accuracy prediction of correct result: {prob} for {name}\033[0m"
                        )
                        low_acc += 1
                elif result["rank"] == 1:
                    print(
                        f"\033[91mincorrect result: expected {target_class_nums}: {[aux_data.class_names[-1][x] for x in target_class_nums]}\033[0m"
                    )
                print(
                    "top {}, class: {}, class name: {}, score: {}".format(
                        i, num, name, prob
                    )
                )
            print()
        print(f"{n} tests performed")
        print(f"number correct (incl low accuracy): {correct}")
        print(f"number low accuracy: {low_acc}")
        print(f"{round(100 * correct / n, 2)}% accuracy predictions")
        print(f"{round(100 * (correct - low_acc) / n, 2)}% high-accuracy predictions")
    else:
        results = model.get_classes(args.rxnsmiles, num_results=num_results)["result"]
        print()
        print("-" * 80)
        print(
            "{0:<5}{1:<16}{2:<50}{3:<9}".format(
                "Rank", "Reaction Number", "Reaction Name", "Certainty"
            )
        )
        print("-" * 80)
        for result in results:
            print(
                "{0:<5}{1:<16}{2:<50}{3:<9.3g}".format(
                    result["rank"],
                    result["reaction_num"],
                    result["reaction_name"],
                    result["prediction_certainty"],
                )
            )
        print("-" * 80)
        print()


if __name__ == "__main__":
    main()
