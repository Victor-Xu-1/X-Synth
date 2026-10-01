import tensorflow as tf


class TFSavedModelWrapper:
    """
    Convenience wrapper for using serving signature of TF SavedModel.
    """

    def __init__(self, path, dtypes):
        self.path = path
        self.dtypes = dtypes

        self.model = tf.keras.models.load_model(self.path)
        self.inference = self.model.signatures["serving_default"]

    def preprocess(self, inputs):
        """Preprocess model inputs before inference."""
        return {
            "input_{0}".format(i + 1): tf.convert_to_tensor(inp, dtype=self.dtypes[i])
            for i, inp in enumerate(inputs)
        }

    def postprocess(self, outputs):
        """Postprocess model outputs after inference."""
        return outputs["output_1"]

    def predict(self, inputs):
        """Run model prediction."""
        return self.postprocess(self.inference(**self.preprocess(inputs)))
