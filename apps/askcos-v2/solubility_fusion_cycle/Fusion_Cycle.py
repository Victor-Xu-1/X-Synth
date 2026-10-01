import numpy as np
import os
import pandas as pd
import torch
from chemprop import data, featurizers,models
from chemprop.models import MPNN, multi
from Density.QSPR import DensityFiller
from lightning import pytorch as pl

# Detect number of available CUDA devices
num_devices = torch.cuda.device_count()

if num_devices > 0:
    os.environ["CUDA_VISIBLE_DEVICES"] = "0"
    device = torch.device("cuda")
    print(f"Using GPU device 0 (total available: {num_devices})")
else:
    os.environ["CUDA_VISIBLE_DEVICES"] = ""
    device = torch.device("cpu")
    print("No GPU detected, running on CPU")


class model:
    def __init__(self, N_iteration=10, thresh=0.99, Num_ensembles=5, mixture=False):
        self.N_iteration = N_iteration
        self.thresh = thresh
        self.Num_ensembles = Num_ensembles
        self.R = 1.98720425864083/1000 # Kcal K-1 mol-1
        self.mixture = mixture

        self.density_filler = DensityFiller()
        self.MP_models = self._init_models(
            model_class=MPNN,
            checkpoint_list=[f"trained_models/MP/model_{i}.pt"
                             for i in range(self.Num_ensembles)]
        )
        self.dHfus_models = self._init_models(
            model_class=MPNN,
            checkpoint_list=[f"trained_models/dHfus/model_{i}.pt"
                             for i in range(self.Num_ensembles)]
        )
        self.gamma_models = self._init_models(
            model_class=multi.MulticomponentMPNN,
            checkpoint_list=[f"trained_models/gamma/model_final_{i}.pt"
                             for i in range(self.Num_ensembles)]
        )

    @staticmethod
    def _init_models(model_class, checkpoint_list: list[str]) -> list:
        mpnns = []
        for checkpoint_path in checkpoint_list:
            mpnn = model_class.load_from_file(checkpoint_path, map_location=device)
            mpnns.append(mpnn)

        return mpnns

    # Function that takes in a list of single molecule
    # model paths and a test dataframe
    # It returns a list of predictions for the smiles in
    # the 'solute_smiles_canonical' columns of the dataframe
    @staticmethod
    def predict_single(mpnns: list, df_test: pd.DataFrame) -> list:
        pred_list = []
        for mpnn in mpnns:
            smiles_columns = 'solute_smiles_canonical' # name of the column containing SMILES strings
            smis = df_test[smiles_columns].values
            test_data = [data.MoleculeDatapoint.from_smi(smi) for smi in smis]
            featurizer = featurizers.SimpleMoleculeMolGraphFeaturizer()
            test_dset = data.MoleculeDataset(test_data, featurizer=featurizer)
            test_loader = data.build_dataloader(test_dset, shuffle=False, batch_size=1)
            with torch.inference_mode():
                trainer = pl.Trainer(
                    logger=None,
                    enable_progress_bar=True
                )
                test_preds = trainer.predict(mpnn, test_loader)
            test_preds = np.concatenate(test_preds, axis=0)
            pred_list.append(test_preds)

        return pred_list

    # Function that takes in a list of multi-component MPNN
    # model paths, a test dataframe, and a vector of molar fraction x
    # It the dataframe with mean and std of gamma predictions for the
    # solutes in 'solute_smiles_canonical' and solvents in 'solvent_smiles_canonical'
    # of the columns of the dataframe
    @staticmethod
    def predict(mcmpnns: list, df_test: pd.DataFrame, x) -> pd.DataFrame:
        pred_list = []
        for mcmpnn in mcmpnns:
            smiles_columns = ['solute_smiles_canonical',
                              'solvent_smiles_canonical']  # name of the column containing SMILES strings
            smiss = df_test[smiles_columns].values
            n_componenets = len(smiles_columns)
            X_d = np.concatenate([x, df_test[['Temperature [K]']].to_numpy()], axis=1)
            test_datapointss = [[data.MoleculeDatapoint.from_smi(smi, x_d=X_d) for smi, X_d in zip(smiss[:, i], X_d)]
                                for i in range(n_componenets)]
            featurizer = featurizers.SimpleMoleculeMolGraphFeaturizer()
            test_dsets = [data.MoleculeDataset(test_datapoints, featurizer) for test_datapoints in test_datapointss]
            test_mcdset = data.MulticomponentDataset(test_dsets)
            test_loader = data.build_dataloader(test_mcdset, shuffle=False, batch_size=1)
            with torch.inference_mode():
                trainer = pl.Trainer(
                    logger=None,
                    enable_progress_bar=True,
                    accelerator="auto",
                    devices=1
                )
                test_preds = trainer.predict(mcmpnn, test_loader)
            test_preds = np.concatenate(test_preds, axis=0)
            pred_list.append(test_preds)
        df_test['ln_gamma'] = np.array(pred_list)[:, :, 0].mean(axis=0)
        df_test['ln_gamma_std'] = np.array(pred_list)[:, :, 0].std(axis=0)

        return df_test

        # Function to calculate molar fraction
    # It takes in the molar fraction x0 and
    # a dataframe that has columns for MP_pred,
    # dHfus_pred, Temperature [K], and gamma
    # It uses a default threshold of 0.99 as
    # maximum allowable mole fraction
    # it returns molar fraction x
    def calc_x_solid(self, x0, df, gamma_models):
        df = self.predict(
            mcmpnns=gamma_models,
            df_test=df,
            x=pd.DataFrame(x0).to_numpy()
        )       # predict gamma at x0
        x = np.exp(df['dHfus_pred'] / self.R * ((1 / df['MP_pred']) - (1 / df['Temperature [K]'])) - (df['ln_gamma']))
        x[x>self.thresh] = self.thresh

        return x,np.exp(df['ln_gamma'])

    # Function that calculates solid solubililty
    # it takes in a dataframe with columns
    # 'solute_smiles_canonical', 'solvent_smiles_canonical',
    # 'Temperature [K]', and 'solvent_density'
    # the function predicts MP based on trained
    # models. Then it iterates with an initial guess of gamma=0
    # to approximate solubility at saturation
    def calculate_solubility_solid(self,df):
        print('solid',df.shape[0])
        # Predict dHfus
        preds = self.predict_single(self.dHfus_models, df)
        df['dHfus_pred'] = np.array(preds)[:,:,0].T.mean(axis=1)
        df['dHfus_std'] = np.array(preds)[:,:,0].T.std(axis=1)
        # Calculate solubility
        checkpoint_path_list = []
        x = df[['dHfus_std']] * 0 # initialize at infinite dilution
        for i in range(self.N_iteration): # Iterate to adjust for x
            x, gamma = self.calc_x_solid(x0=x, df=df, gamma_models=self.gamma_models)
            S = x * df['solvent_density']
            logS = np.log10(S)

        return logS, gamma

    # Function to calculate molar fraction
    # It takes in the molar fraction x1, x2,
    # and a dataframe. 
    # It uses a default threshold of 0.99 as
    # maximum allowable mole fraction
    # it returns molar fractions x1 and x2
    def calc_x_liquid(self, x1, x2, df, gamma_models):
        df = self.predict(mcmpnns=gamma_models, df_test=df, x=pd.DataFrame(x2).to_numpy())
        gamma2 = np.exp(df['ln_gamma'])
        df = self.predict(mcmpnns=gamma_models, df_test=df, x=pd.DataFrame(x1).to_numpy())
        gamma1 = np.exp(df['ln_gamma'])
        x1 = gamma2/gamma1 * x2.values.flatten()
        x1[x1>self.thresh] = self.thresh
        df = self.predict(mcmpnns=gamma_models, df_test=df, x=pd.DataFrame(x1).to_numpy())
        gamma1 = np.exp(df['ln_gamma'])
        x2 = gamma1/gamma2 * x1.values.flatten()
        x2[x2>self.thresh] = self.thresh

        return x1, x2, gamma1, gamma2

    # Function that calculates liquid solubililty
    # it takes in a dataframe with columns
    # 'solute_smiles_canonical', 'solvent_smiles_canonical',
    # 'Temperature [K]', and 'solvent_density'
    # The function iterates with an initial guess of x1=0
    # and x2=1 to approximate solubility at saturation
    def calculate_solubility_liquid(self, df: pd.DataFrame):
        print('liquid',df.shape[0])
        # Calculate solubility
        x1 = df[['MP_std']] * 0.0 # initialize solvent-rich phase
        x2 = x1 + 1.0 # initialize solute-rich phase
        for i in range(self.N_iteration): # Iterate to adjust for x
            x1, x2, gamma1, gamma2 = self.calc_x_liquid(x1=x1, x2=x2, df=df, gamma_models=self.gamma_models)
            S = x1 * df['solvent_density']
            logS = np.log10(S)

        return logS,gamma1

    def calculate_solubility(self, df):
        # Use QSPR to fill in missing solvent densities (approximated at 298K)
        # df = fill_solvent_density(df)
        df = self.density_filler.fill_solvent_density(df)
        # Predict MP
        preds = self.predict_single(mpnns=self.MP_models, df_test=df)

        df['MP_pred'] = np.array(preds)[:,:,0].T.mean(axis=1)
        df['MP_std'] = np.array(preds)[:,:,0].T.std(axis=1)
        # Split data to solid/liquid
        idx = df['MP_pred']>df['Temperature [K]']
        df_solid  = df[ idx].reset_index(drop=True)
        df_liquid = df[-idx].reset_index(drop=True)
        # Route to functions
        df['logS_calc'] = 0.0   # initialize
        df['gamma'] = 0.0       # initialize

        if df_solid.shape[0]>0:
            logS, gamma = self.calculate_solubility_solid(df_solid)
            df.loc[idx, ['logS_calc', 'gamma']] = np.vstack([logS, gamma]).T
            # df.loc[ idx,['logS_calc','gamma']] = self.calculate_solubility_solid(df_solid)
        if df_liquid.shape[0]>0:
            logS, gamma = self.calculate_solubility_liquid(df_liquid)
            df.loc[-idx,['logS_calc','gamma']] = np.vstack([logS, gamma]).T
            # df.loc[-idx,['logS_calc','gamma']] = self.calculate_solubility_liquid(df_liquid)

        return df.to_dict(orient="records")
