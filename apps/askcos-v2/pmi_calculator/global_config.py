import os

# Output debugging statements
DEBUG = False

# Whether to preload all templates for the retrotransformer
PRELOAD_TEMPLATES = False

################################################################################
# Options for different modules, defined as strings
################################################################################

# For pathway scoring:
forwardonly = "Forward only"
templateonly = "Template only"
product = "Product"

# For precursor prioritization
relevanceheuristic = "RelevanceHeuristic"
heuristic = "Heuristic"
scscore = "SCScore"
mincost = "MinCost"
mean = "Mean"
geometric = "Geometric"
pow8 = "Power of 8"
max = "Maximum"

# For template prioritization
popularity = "Popularity"
relevance = "Relevance"

# For deciding the best context
probability = "Probability"
rank = "Rank"

# For context recommendation
nearest_neighbor = "Nearest_Neighbor"
neural_network = "Neural_Network"
context_neural_network_v2 = "Neural_Network_V2"

# For forward prediction
template = "Template"
network = "Neural_Network"

# For reaction evaluation
fastfilter = "Fast_Filter"
templatefree = "Template_Free"
templatebased = "Template_Based"
forward_scoring_needs_context = {
    "Fast_Filter": False,
    "Template_Free": True,
    "Template_Based": True,
}
forward_scoring_needs_context_necessary_reagent = {
    "Fast_Filter": False,
    "Template_Free": True,
    "Template_Based": True,
}

# Set which modules should be used as defaults
context_module = neural_network
synth_enumeration = template
retro_enumeration = template
prioritizaton = heuristic
forward_scoring = network

################################################################################
# Define data file locations
################################################################################

data_path = os.environ.get(
    "ASKCOS_DATA_DIR", os.path.join(os.path.dirname(__file__), "data")
)
local_db_dumps = os.path.join(data_path, "local_db_dumps")
models_path = os.path.join(data_path, "models")
scalers_path = os.path.join(data_path, "scalers")

fingerprint_bits = 256
reaction_fingerprint_bits = 2048


database = "askcos"

################################################################################
# Define databases (should be nonessential if all local files present)
################################################################################

MONGO = {
    "host": os.environ.get("MONGO_HOST"),
    "port": int(os.environ.get("MONGO_PORT", 27017)),
    "username": os.environ.get("MONGO_USER"),
    "password": os.environ.get("MONGO_PW"),
    "authSource": os.environ.get("MONGO_AUTH_DB", "admin"),
    "connect": False,
}

RETRO_TEMPLATES = {
    "database": database,
    "collection": "retro_templates",
    "reaxys": {
        "file_name": os.path.join(
            data_path, "db", "templates", "retro.templates.json.gz"
        ),
    },
    "pistachio": {
        "file_name": os.path.join(
            data_path, "db", "templates", "retro.templates.pistachio.json.gz"
        ),
    },
    "cas": {
        "file_name": os.path.join(
            data_path, "db", "templates", "retro.templates.cas.json.gz"
        ),
    },
    "bkms": {
        "file_name": os.path.join(
            data_path, "db", "templates", "retro.templates.bkms.json.gz"
        ),
    },
    "pistachio:ringbreaker": {
        "file_name": os.path.join(
            data_path,
            "db",
            "templates",
            "retro.templates.pistachio_ringbreaker.json.gz",
        ),
    },
}

FORWARD_TEMPLATES = {
    "file_name": os.path.join(
        data_path, "db", "templates", "forward.templates.json.gz"
    ),
    "database": database,
    "collection": "forward_templates",
}

REACTIONS = {
    "database": database,
    "collection": "reactions",
}

CHEMICALS = {
    "database": database,
    "collection": "chemicals",
    "reaxys": {
        "file_name": os.path.join(data_path, "db", "historian", "chemicals.json.gz"),
    },
    "pistachio": {
        "file_name": os.path.join(
            data_path, "db", "historian", "historian.pistachio.json.gz"
        ),
    },
    "bkms": {
        "file_name": os.path.join(
            data_path, "db", "historian", "historian.bkms.json.gz"
        ),
    },
}

BUYABLES = {
    "file_name": os.path.join(data_path, "db", "buyables", "buyables.json.gz"),
    "database": database,
    "collection": "buyables",
}

SOLVENTS = {
    "file_name": os.path.join(data_path, "solvents", "abraham_solvents.pkl"),
    "database": database,
    "collection": "solvents",
}

# Fast filter evaluation
FAST_FILTER_MODEL = {
    "model_path": os.path.join(models_path, "fast_filter", "1"),
}

# Template relevance models are trained on a specific template set which should be defined with the model
# The model name will typically match the template set, but multiple models could be trained on the same template set
RELEVANCE_TEMPLATE_PRIORITIZATION = {
    "reaxys": {
        "model_path": os.path.join(
            models_path, "template_prioritization", "reaxys", "1"
        ),
        "template_set": "reaxys",
    },
    "pistachio": {
        "model_path": os.path.join(
            models_path, "template_prioritization", "pistachio", "1"
        ),
        "template_set": "pistachio",
    },
    "cas": {
        "model_path": os.path.join(models_path, "template_prioritization", "cas", "1"),
        "template_set": "cas",
    },
    "bkms": {
        "model_path": os.path.join(models_path, "template_prioritization", "bkms", "1"),
        "template_set": "bkms",
    },
    "pistachio:ringbreaker": {
        "model_path": os.path.join(
            models_path, "template_prioritization", "pistachio_ringbreaker", "1"
        ),
        "template_set": "pistachio:ringbreaker",
    },
}

# C++ tree builder server
# WARNING: Only the first server is used at this time
# WARNING: As an experimental feature, the models will be replaced with production models in the future.
__CPP_Tree_Builder_v1_default_model = "pistachio-202103-112609-experimental"
CPP_Tree_Builder_v1_Config = {
    # WARNING: Make sure there is enough memory before increasing max_allowed_steps
    # 50k steps (single thread) may use as much as 16GB memory.
    "max_allowed_steps": int(
        os.environ.get("CPP_TREE_BUILDER_MAX_ALLOWED_STEPS", 10000)
    ),
    "servers": [
        {
            "token": os.environ.get("CPP_TREE_BUILDER_USER_TOKEN", "userauthtoken"),
            "server": "http://"
            + os.environ.get("CPP_TREE_BUILDER_SERVER_HOSTNAME", "cpptbv1"),
            "admin_token": os.environ.get(
                "CPP_TREE_BUILDER_ADMIN_TOKEN", "admin_auth_token"
            ),
        },
    ],
    "policy": {
        "default": {
            "expansion_policy": {
                "type": "TemplateCached_PathDepend",
                "fastfilter_dir": FAST_FILTER_MODEL["model_path"],
                "templaterelevance_model_dir": os.path.join(
                    models_path,
                    "rl",
                    __CPP_Tree_Builder_v1_default_model,
                    "path_dependent_retro_template_relevance",
                    "final",
                ),
                "template_json": os.path.join(
                    models_path,
                    "rl",
                    __CPP_Tree_Builder_v1_default_model,
                    "templates.json.gz",
                ),
                "is_random": False,
                "num_non_random": 100,
                "max_num_templates": 100,
                "max_cum_prob": 1.0,
                "num_look_back": 0,
                "fastfilter_threshold": 0.5,
            },
            "selection_policy": {
                "type": "AGZ",
                "is_random": False,
                "exploration_cofficient": 150.0,
                "add_fwd_score": True,
            },
            "valuation_policy": {
                "type": "PathwayDepth",
                "model_fn": os.path.join(
                    models_path,
                    "rl",
                    __CPP_Tree_Builder_v1_default_model,
                    "pathway_depth",
                    "final",
                ),
            },
            "property_policy": {
                "type": "Buyable",
                "size": 0,
                "model_fn": BUYABLES["file_name"],
            },
            "backpropagation_policy": {
                "type": "MinDepth",
                "backtrack_penalty_action_score": 1.0,
                "set_action_score_as_buyable_depth": True,
            },
        },
    },
    "job_config": {
        "do_label_tree": True,
        "return_policies": False,
        "backtrack_penalty_action_score": 1,
        "set_action_score_as_buyable_depth": True,
        "remove_empty_edge": True,
        "output_dir": "",
    },
}

# Different SCScore models that are all functionally similary
SCScore_Prioritiaztion = {
    "trained_model_path_1024bool": os.path.join(
        models_path, "scscore", "model_1024bool.pickle"
    ),
    "trained_model_path_2048bool": os.path.join(
        models_path, "scscore", "model_2048bool.pickle"
    ),
    "trained_model_path_1024uint8": os.path.join(
        models_path, "scscore", "model_1024uint8.pickle"
    ),
}

MinCost_Prioritiaztion = {
    "trained_model_path": os.path.join(models_path, "mincost", "model.hdf5")
}

NEURALNET_CONTEXT_REC = {
    "info_path": os.path.join(models_path, "context", "NeuralNet_Cont_Model/"),
    "model_path": os.path.join(
        models_path, "context", "NeuralNet_Cont_Model", "model.json"
    ),
    "weights_path": os.path.join(
        models_path, "context", "NeuralNet_Cont_Model", "weights.h5"
    ),
    "database": database,
}

_CONTEXT_V2_MODEL_PATH = os.path.join(models_path, "context", "v2")
CONTEXT_V2 = {
    "reagent_conv_rules": os.path.join(
        _CONTEXT_V2_MODEL_PATH, "stage0", "reagent_conv_rules.json"
    ),
    "default-models": {
        "graph": "graph-20191118",
        "fp": "fp-small-20191118",
    },
    "models": {
        "fp-20191118": {
            "fp_len": 16384,
            "fp_rad": 3,
            "reagents": os.path.join(
                _CONTEXT_V2_MODEL_PATH, "stage0", "reagents_list_minocc100.json"
            ),
            "reagents_model": os.path.join(
                _CONTEXT_V2_MODEL_PATH,
                "stage1",
                "fp_multicategorical_50_input_reagents_fplength16384_fpradius3",
                "model-densegraph-04-4.18.hdf5.final-tf.20191118",
            ),
            "temperature_model": os.path.join(
                _CONTEXT_V2_MODEL_PATH,
                "stage2",
                "50_temperature_regression_fp_baseline",
                "model-densegraph-24-0.02.hdf5.final-tf.20191118",
            ),
            "reagents_amount_model": os.path.join(
                _CONTEXT_V2_MODEL_PATH,
                "stage3",
                "50_amount_regression_fp_baseline",
                "model-densegraph-12-0.00.hdf5.final-tf.20191118",
            ),
            "reactants_amount_model": os.path.join(
                _CONTEXT_V2_MODEL_PATH,
                "stage3",
                "50_amount_reactant_regression_fp_baseline_dense2048_3",
                "model-densegraph-24-0.05.hdf5.final-tf.20191118",
            ),
        },
        "fp-small-20191118": {
            "fp_len": 2048,
            "fp_rad": 3,
            "reagents": os.path.join(
                _CONTEXT_V2_MODEL_PATH, "stage0", "reagents_list_minocc100.json"
            ),
            "reagents_model": os.path.join(
                _CONTEXT_V2_MODEL_PATH,
                "stage1",
                "fp_multicategorical_50_input_reagents_fplength2048_fpradius3",
                "model-densegraph-04-4.27.hdf5.final-tf.20191118",
            ),
            "temperature_model": os.path.join(
                _CONTEXT_V2_MODEL_PATH,
                "stage2",
                "50_temperature_regression_fp_baseline_fp2048",
                "model-densegraph-40-0.02.hdf5.final-tf.20191118",
            ),
            "reagents_amount_model": os.path.join(
                _CONTEXT_V2_MODEL_PATH,
                "stage3",
                "50_amount_regression_fp_baseline_fp2048",
                "model-densegraph-48-0.00.hdf5.final-tf.20191118",
            ),
            "reactants_amount_model": os.path.join(
                _CONTEXT_V2_MODEL_PATH,
                "stage3",
                "50_amount_reactant_regression_fp_baseline_fp2048_dense512",
                "model-densegraph-04-0.05.hdf5.final-tf.20191118",
            ),
        },
        "graph-20191118": {
            "encoder": os.path.join(
                _CONTEXT_V2_MODEL_PATH,
                "stage0",
                "feature-statistics-final-s-natom50.pickle",
            ),
            "reagents": os.path.join(
                _CONTEXT_V2_MODEL_PATH, "stage0", "reagents_list_minocc100.json"
            ),
            "reagents_model": os.path.join(
                _CONTEXT_V2_MODEL_PATH,
                "stage1",
                "50_multicategorical_input_reagents_wlnlen512_wlnstep3",
                "model-densegraph-08-4.08.hdf5.final-tf.20191118",
            ),
            "temperature_model": os.path.join(
                _CONTEXT_V2_MODEL_PATH,
                "stage2",
                "50_temperature_regression",
                "model-densegraph-16-0.02.hdf5.final-tf.20191118",
            ),
            "reagents_amount_model": os.path.join(
                _CONTEXT_V2_MODEL_PATH,
                "stage3",
                "50_amount_regression",
                "model-densegraph-08-0.00.hdf5.final-tf.20191118",
            ),
            "reactants_amount_model": os.path.join(
                _CONTEXT_V2_MODEL_PATH,
                "stage3",
                "50_amount_reactant_regression_dense2048_3",
                "model-densegraph-08-0.05.hdf5.final-tf.20191118",
            ),
            "condensed_graph": True,
        },
    },
}

TEMPLATE_FREE_FORWARD_PREDICTOR = {
    "uspto_500k": {
        "core_model_path": os.path.join(
            models_path, "forward_predictor", "uspto_500k", "core", "1"
        ),
        "rank_model_path": os.path.join(
            models_path, "forward_predictor", "uspto_500k", "rank", "1"
        ),
    },
}

SELECTIVITY = {
    "model_path": os.path.join(models_path, "selectivity", "model.ckpt-30615")
}

GEN_SELECTIVITY = {
    "model_path": {
        "GNN": os.path.join(
            models_path, "selectivity", "general_selectivity", "GNN_best_model.hdf5"
        ),
        "QM_GNN": os.path.join(
            models_path, "selectivity", "general_selectivity", "QM_GNN_best_model.hdf5"
        ),
        "QM_GNN_no_reagent": os.path.join(
            models_path,
            "selectivity",
            "general_selectivity",
            "QM_GNN_best_model_no_reagent.hdf5",
        ),
    },
    "scalers": os.path.join(scalers_path, "QM_desc_selec.pickle"),
}

PATHWAY_RANKER = {
    "model_path": os.path.join(models_path, "pathway_ranker", "treeLSTM512-fp2048.pt")
}

DESCRIPTORS = {"model_path": os.path.join(models_path, "descriptors", "QM_137k.pt")}

_REACTION_CLASSIFICATION_MODEL_PATH = os.path.join(
    models_path, "reaction_classification", "1"
)
REACTION_CLASSIFICATION = {
    "model_path": _REACTION_CLASSIFICATION_MODEL_PATH,
    "vocab_file": os.path.join(_REACTION_CLASSIFICATION_MODEL_PATH, "vocab.txt"),
    "max_seq_length": 512,
    "class_name_json": [
        os.path.join(_REACTION_CLASSIFICATION_MODEL_PATH, "rxn_class_name_super0.json"),
        os.path.join(_REACTION_CLASSIFICATION_MODEL_PATH, "rxn_class_name_super1.json"),
        os.path.join(_REACTION_CLASSIFICATION_MODEL_PATH, "rxn_class_name.json"),
    ],
    "encoder_json": [
        os.path.join(_REACTION_CLASSIFICATION_MODEL_PATH, "encoder0.json"),
        os.path.join(_REACTION_CLASSIFICATION_MODEL_PATH, "encoder1.json"),
        os.path.join(_REACTION_CLASSIFICATION_MODEL_PATH, "encoder2.json"),
    ],
    "decoder_json": [
        os.path.join(_REACTION_CLASSIFICATION_MODEL_PATH, "decoder0.json"),
        os.path.join(_REACTION_CLASSIFICATION_MODEL_PATH, "decoder1.json"),
        os.path.join(_REACTION_CLASSIFICATION_MODEL_PATH, "decoder2.json"),
    ],
}
