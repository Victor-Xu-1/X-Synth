import torch
import numpy as np
import glob
import os
from utils import smi_to_fp, clear_atom_map



class MyMLPHandler:
    def __init__(self):
        self._context = None
        self.manifest = None
        self.initialized = False


    def initialize(self, context):
        self._context = context
        self.manifest = context.manifest

        properties = context.system_properties
        model_dir = properties.get("model_dir")
        print(glob.glob(f"{model_dir}/*"))
        if torch.cuda.is_available():
            self.device = torch.device("cuda:" + str(properties.get("gpu_id")))
            self.use_cpu = False
        else:
            self.device = torch.device("cpu")
            self.use_cpu = True

        checkpoint_file = os.path.join(model_dir, "epoch_100.pt")
        if not os.path.isfile(checkpoint_file):
            checkpoint_list = sorted(glob.glob(os.path.join(model_dir, f"epoch_*.pt")))
            print(f"Default checkpoint file {checkpoint_file} not found!")
            print(f"Using found last checkpoint {checkpoint_list[-1]} instead.")
            checkpoint_file = checkpoint_list[-1]

        from value_mlp import ValueMLP
        from parse_args import parser
        args, _ = parser.parse_known_args()

        self.model = ValueMLP(
            n_layers=args.n_layers,
            fp_dim=args.fp_dim,
            latent_dim=args.latent_dim,
            dropout_rate=args.dropout,
            device=self.device
        )
        pretrain_state_dict = torch.load(checkpoint_file, map_location=self.device)
        pretrain_state_dict = {k.replace("module.", ""): v for k, v in pretrain_state_dict.items()}
        self.model.load_state_dict(pretrain_state_dict)

        self.initialized = True

    def preprocess(self, data):
        # Preprocess the input data as needed
        # Example: Convert input JSON to tensor
        fp_list = [smi_to_fp(clear_atom_map(smi))
                            for smi in data[0]["body"]["smiles"]]
        fps = np.stack(fp_list)
        fps = torch.FloatTensor(fps)
        return fps

    def inference(self, input_tensor):
        # Perform inference
        self.model.eval()
        with torch.no_grad():
            print(input_tensor.shape)
            output = self.model(input_tensor)
            output = output.view(input_tensor.shape[0])
            print(output.shape)
        return output

    def postprocess(self, output):
        # Convert the model output to a format suitable for response

        result = []
        for score in output:
            result.append(score.numpy().tolist())

        # response = output.numpy().tolist()  # Convert to list for JSON serialization
        return [result]

    def handle(self, data, context):
        self._context = context

        if self.model is None:
            self.load_model()

        input_tensor = self.preprocess(data)
        output = self.inference(input_tensor)
        return self.postprocess(output)
