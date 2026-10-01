import argparse
import os


parser = argparse.ArgumentParser()

# Set up argparse
parser = argparse.ArgumentParser(description="Model training parameters.")


parser.add_argument('--train_file', type=str, default='')
parser.add_argument('--val_file', type=str, default='')
parser.add_argument('--test_file', type=str, default='')
parser.add_argument('--bb_file', type=str, default='')
parser.add_argument('--processed_folder', type=str, default='')
parser.add_argument('--checkpoints_folder', type=str, default='')



# Define arguments based on the class attributes
parser.add_argument('--num_cores', type=int, default=16)
parser.add_argument('--seed', type=int, default=10)
parser.add_argument('--n_layers', type=int, default=6)
parser.add_argument('--fp_dim', type=int, default=2048)
parser.add_argument('--latent_dim', type=int, default=128)
parser.add_argument('--batch_size', type=int, default=14000)
parser.add_argument('--dropout', type=float, default=0.1)
parser.add_argument('--n_epochs', type=int, default=100)
parser.add_argument('--lr', type=float, default=5e-3)
parser.add_argument('--save_epoch_int', type=int, default=1)
parser.add_argument('--lr_scheduler_factor', type=float, default=0.99)
parser.add_argument('--lr_scheduler_patience', type=int, default=5)
parser.add_argument('--lr_cooldown', type=int, default=0)