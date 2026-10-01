import json

import global_config as gc
import tokenization

MODEL_PATH = gc.REACTION_CLASSIFICATION["model_path"]
MAX_SEQ_LENGTH = gc.REACTION_CLASSIFICATION["max_seq_length"]
VOCAB_FILE = gc.REACTION_CLASSIFICATION["vocab_file"]
CLASS_NAME_JSON = gc.REACTION_CLASSIFICATION["class_name_json"]
ENCODER_JSON = gc.REACTION_CLASSIFICATION["encoder_json"]
DECODER_JSON = gc.REACTION_CLASSIFICATION["decoder_json"]
AUX_DATA = None


def get_aux_data():
    global AUX_DATA
    if AUX_DATA is None:
        AUX_DATA = ReactionClassAuxData()
    return AUX_DATA


class ReactionClassAuxData:
    def __init__(self):
        self.vocab = self.load_vocab()
        self.encoders = self.load_encoders()
        self.decoders = self.load_decoders()
        self.class_names = self.load_rxn_number_to_class_name()

    @staticmethod
    def load_vocab():
        return tokenization.load_vocab(VOCAB_FILE)

    @staticmethod
    def load_encoders():
        res = []
        for fn in ENCODER_JSON:
            with open(fn, "r") as f:
                res.append(json.load(f))
        return res

    @staticmethod
    def load_decoders():
        res = []
        for fn in DECODER_JSON:
            with open(fn, "r") as f:
                d = json.load(f)
            _d = {}
            for k, v in d.items():
                _d[int(k)] = v
            res.append(_d)
        return res

    @staticmethod
    def load_rxn_number_to_class_name():
        res = []
        for fn in CLASS_NAME_JSON:
            with open(fn, "r") as f:
                d = json.load(f)
            res.append(d)
        return res
