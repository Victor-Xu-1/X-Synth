"""
This module defines the evaluate function for the QM descriptor predictor
"""

import pandas as pd
from rdkit import Chem

import chemprop


class QM_DescriptorModel:
    def __init__(self):
        self.atom_bond_model_objects = None
        self.dipole_quadrupole_moments_model_objects = None
        self.energy_gaps_IP_EA_model_objects = None
        self.initialize()

    def initialize(self):
        # model loading
        arguments = [
            "--test_path", "/dev/null",
            "--constraints_path", "/dev/null",
            "--preds_path", "/dev/null",
            "--checkpoint_dir", "./models/atom_bond_descriptors/random/",
        ]
        args = chemprop.args.PredictArgs().parse_args(arguments)
        self.atom_bond_model_objects = chemprop.train.load_model(args=args)

        arguments = [
            "--test_path", "/dev/null",
            "--preds_path", "/dev/null",
            "--checkpoint_dir", "./models/dipole_quadrupole_moments/random/",
        ]
        args = chemprop.args.PredictArgs().parse_args(arguments)
        self.dipole_quadrupole_moments_model_objects = chemprop.train.load_model(
            args=args
        )

        arguments = [
            "--test_path", "/dev/null",
            "--preds_path", "/dev/null",
            "--checkpoint_dir", "./models/energy_gaps_IP_EA/random/",
        ]
        args = chemprop.args.PredictArgs().parse_args(arguments)
        self.energy_gaps_IP_EA_model_objects = chemprop.train.load_model(args=args)

    @staticmethod
    def get_constaints(smiles: str):
        mol = Chem.MolFromSmiles(smiles)
        charge = Chem.GetFormalCharge(mol)
        df_constraints = pd.DataFrame(
            {
                "npa_charge": [charge],
                "npa_charge_plus": [charge + 1],
                "npa_charge_minus": [charge - 1],
                "npa_parr_neu": [1],
                "npa_parr_elec": [1],
            }
        )
        df_constraints.to_csv("constraints.csv", index=False)

    def predict(self, smiles: str):
        # prepare a file for testing path
        df = pd.DataFrame()
        df["smiles"] = [smiles]
        df.to_csv("test_path.csv", index=False)

        # prepare a file containing constraints for each atom/bond property
        self.get_constaints(smiles)

        # predict atom/bond properties
        arguments = [
            "--test_path", "test_path.csv",
            "--constraints_path", "constraints.csv",
            "--preds_path", "/dev/null",
            "--checkpoint_dir", "./models/atom_bond_descriptors/random/",
            "--num_workers", "0",
        ]

        args = chemprop.args.PredictArgs().parse_args(arguments)
        _, train_args, models, scalers, num_tasks, task_names = (
            self.atom_bond_model_objects
        )
        chemprop.utils.update_prediction_args(predict_args=args, train_args=train_args)
        atom_bond_preds = chemprop.train.make_predictions(
            args=args,
            model_objects=(args, train_args, models, scalers, num_tasks, task_names),
        )

        # predict dipole and quadrupole moments
        arguments = [
            "--test_path", "test_path.csv",
            "--preds_path", "/dev/null",
            "--checkpoint_dir", "./models/dipole_quadrupole_moments/random/",
            "--num_workers", "0",
        ]

        args = chemprop.args.PredictArgs().parse_args(arguments)
        _, train_args, models, scalers, num_tasks, task_names = (
            self.dipole_quadrupole_moments_model_objects
        )
        chemprop.utils.update_prediction_args(predict_args=args, train_args=train_args)
        dipole_quadrupole_moments_preds = chemprop.train.make_predictions(
            args=args,
            model_objects=(args, train_args, models, scalers, num_tasks, task_names),
        )

        # predict energy gaps, IP, and EA
        arguments = [
            "--test_path", "test_path.csv",
            "--preds_path", "/dev/null",
            "--checkpoint_dir", "./models/energy_gaps_IP_EA/random/",
            "--num_workers", "0",
        ]

        args = chemprop.args.PredictArgs().parse_args(arguments)
        _, train_args, models, scalers, num_tasks, task_names = (
            self.energy_gaps_IP_EA_model_objects
        )
        chemprop.utils.update_prediction_args(predict_args=args, train_args=train_args)
        energy_gaps_IP_EA_preds = chemprop.train.make_predictions(
            args=args,
            model_objects=(args, train_args, models, scalers, num_tasks, task_names),
        )

        # post processing the results
        results = {
            "smiles": smiles,
            "npa charge (e)": atom_bond_preds[0][0].tolist(),
            "npa charge + (e)": atom_bond_preds[0][1].tolist(),
            "npa charge - (e)": atom_bond_preds[0][2].tolist(),
            "npa parr function + (e)": atom_bond_preds[0][3].tolist(),
            "npa parr function - (e)": atom_bond_preds[0][4].tolist(),
            "shielding constant (ppm)": atom_bond_preds[0][5].tolist(),
            "1s valence orbital occupancy (e)": atom_bond_preds[0][6].tolist(),
            "2s valence orbital occupancy (e)": atom_bond_preds[0][7].tolist(),
            "2p valence orbital occupancy (e)": atom_bond_preds[0][8].tolist(),
            "3s valence orbital occupancy (e)": atom_bond_preds[0][9].tolist(),
            "3p valence orbital occupancy (e)": atom_bond_preds[0][10].tolist(),
            "4s valence orbital occupancy (e)": atom_bond_preds[0][11].tolist(),
            "4p valence orbital occupancy (e)": atom_bond_preds[0][12].tolist(),
            "bond index (unitless)": atom_bond_preds[0][13].tolist(),
            "bond length (Å)": atom_bond_preds[0][14].tolist(),
            "bond charge (e)": atom_bond_preds[0][15].tolist(),
            "natural ionicity (unitless)": atom_bond_preds[0][16].tolist(),
            "dipole moment (debye)": dipole_quadrupole_moments_preds[0][0],
            "traceless quadrupole moment (debye⋅Å)": dipole_quadrupole_moments_preds[0][1],
            "HOMO-3/LUMO (hartree)": energy_gaps_IP_EA_preds[0][0],
            "HOMO-3/LUMO+1 (hartree)": energy_gaps_IP_EA_preds[0][1],
            "HOMO-3/LUMO+2 (hartree)": energy_gaps_IP_EA_preds[0][2],
            "HOMO-3/LUMO+3 (hartree)": energy_gaps_IP_EA_preds[0][3],
            "HOMO-2/LUMO (hartree)": energy_gaps_IP_EA_preds[0][4],
            "HOMO-2/LUMO+1 (hartree)": energy_gaps_IP_EA_preds[0][5],
            "HOMO-2/LUMO+2 (hartree)": energy_gaps_IP_EA_preds[0][6],
            "HOMO-2/LUMO+3 (hartree)": energy_gaps_IP_EA_preds[0][7],
            "HOMO-1/LUMO (hartree)": energy_gaps_IP_EA_preds[0][8],
            "HOMO-1/LUMO+1 (hartree)": energy_gaps_IP_EA_preds[0][9],
            "HOMO-1/LUMO+2 (hartree)": energy_gaps_IP_EA_preds[0][10],
            "HOMO-1/LUMO+3 (hartree)": energy_gaps_IP_EA_preds[0][11],
            "HOMO/LUMO (hartree)": energy_gaps_IP_EA_preds[0][12],
            "HOMO/LUMO+1 (hartree)": energy_gaps_IP_EA_preds[0][13],
            "HOMO/LUMO+2 (hartree)": energy_gaps_IP_EA_preds[0][14],
            "HOMO/LUMO+3 (hartree)": energy_gaps_IP_EA_preds[0][15],
            "IP (hartree)": energy_gaps_IP_EA_preds[0][16],
            "EA (hartree)": energy_gaps_IP_EA_preds[0][17],
        }

        return results


# for testing purpose
if __name__ == "__main__":
    predictor = QM_DescriptorModel()
    smiles = "OCC3OC(OCC2OC(OC(C#N)c1ccccc1)C(O)C(O)C2O)C(O)C(O)C3O"
    results = predictor.predict(smiles)
    print(results)
