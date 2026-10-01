import base64
import collections

import tensorflow as tf
from rdkit import Chem

import classifier_utils_v2 as classifier_utils

import db
import tokenizer_chem


def create_int_feature(values):
    return tf.train.Feature(int64_list=tf.train.Int64List(value=list(values)))


def remove_atommap(mol):
    for atom in mol.GetAtoms():
        atom.ClearProp('molAtomMapNumber')
        # atom.SetAtomMapNum(0)

    return mol


def prepare_smiles(rxnsmiles):
    """
    Preprocess SMILES by removing reagents and canonicalizing using RDKit.
    """
    reactants, _, products = rxnsmiles.strip().split(">")
    return ">>".join(
        Chem.MolToSmiles(
            remove_atommap(
                Chem.MolFromSmiles(smi)
            )
        ) for smi in [reactants, products]
    )


def featurize_smiles(rxnsmiles):
    """
    Generate features for the input reaction SMILES and serialize to string.
    """
    aux_data = db.get_aux_data()
    smiles = prepare_smiles(rxnsmiles)
    smiles_tokenized = tokenizer_chem.smi_tokenizer(smiles)
    input_example = classifier_utils.InputExample(
        guid="0", text_a=smiles_tokenized, text_b=None, label="0.0.0"
    )
    feature = classifier_utils.convert_single_example(
        ex_index=0,
        example=input_example,
        label_encoder=aux_data.encoders[-1],
        max_seq_length=db.MAX_SEQ_LENGTH,
        vocab=aux_data.vocab,
        task_name="rxn_class",
    )

    features = collections.OrderedDict()
    features["input_ids"] = create_int_feature(feature.input_ids)
    features["input_mask"] = create_int_feature(feature.input_mask)
    features["segment_ids"] = create_int_feature(feature.segment_ids)

    tf_example = tf.train.Example(features=tf.train.Features(feature=features))
    return tf_example.SerializeToString()


def str_to_b64(string):
    """
    Return base64 encoding of the input string, as a str.
    """
    return base64.b64encode(string).decode("utf-8")


def decode_one_output(reaction_and_prob, idx):
    """
    Uses the label decoder and label classname to convert the reaction and
    probability to a readable type, and formats our results in a dictionary.
    """
    aux_data = db.get_aux_data()
    label_decoder = aux_data.decoders[-1]
    label_classname = aux_data.class_names

    reaction_num = label_decoder[reaction_and_prob[0]]
    reaction_name = label_classname[2].get(reaction_num)

    reaction_classnum = reaction_num[: reaction_num.rfind(".")]
    reaction_classname = label_classname[1].get(reaction_classnum)

    reaction_superclassnum = reaction_classnum[: reaction_classnum.rfind(".")]
    reaction_superclassname = label_classname[0].get(reaction_superclassnum)

    probability = reaction_and_prob[1]

    return {
        "rank": idx + 1,
        "reaction_num": reaction_num,
        "reaction_name": reaction_name,
        "reaction_classnum": reaction_classnum,
        "reaction_classname": reaction_classname,
        "reaction_superclassnum": reaction_superclassnum,
        "reaction_superclassname": reaction_superclassname,
        "prediction_certainty": probability,
    }


def decode_output(probabilities, num_results):
    """
    Sorts the model prediction outputs by probability, then converts it into readable data.
    Returns a dictionary with status, message, and a list of results.
    """
    # sorts such that the reactions with highest probability are first, and removes null class from output
    probs = sorted(
        ((idx, prob) for idx, prob in enumerate(probabilities) if idx != 0),
        key=lambda x: -x[1],
    )

    return {
        "status": "OK",
        "message": "OK",
        "result": [decode_one_output(probs[idx], idx) for idx in range(num_results)],
    }
