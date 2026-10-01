import os
import numpy as np
import torch
import random
from model.parse_args import parser
from model.value_mlp import ValueMLP
from model.value_data_loader import ValueDataLoader
from model.trainer import Trainer
from model.logger import setup_logger

'''
From Retro* - Binghong et.al 
https://github.com/binghong-ml/retro_star/blob/master/retro_star/train.py 
'''

def train(args):
    args.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

    model = ValueMLP(
        n_layers=args.n_layers,
        fp_dim=args.fp_dim,
        latent_dim=args.latent_dim,
        dropout_rate=args.dropout,
        device=args.device
    )


    train_data_loader = ValueDataLoader(
        file_name=args.train_file,
        batch_size=args.batch_size
    )

    val_data_loader = ValueDataLoader(
        file_name=args.val_file,
        batch_size=args.batch_size
    )

    os.makedirs(args.checkpoints_folder, exist_ok=True)
    trainer = Trainer(
        args=args,
        model=model,
        train_data_loader=train_data_loader,
        val_data_loader=val_data_loader
    )

    trainer.train()


if __name__ == '__main__':
    args = parser.parse_args()
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    setup_logger('train.log')

    train(args)