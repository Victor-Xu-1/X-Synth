import torch
import torch.nn as nn
import torch.nn.functional as F
import logging

'''
From Retro* - Binghong et.al 
https://github.com/binghong-ml/retro_star/blob/master/retro_star/model/value_mlp.py
'''
class Block(nn.Module):
    def __init__(self, size: int, dropout_rate: float):
        super().__init__()
        self.ff = nn.Linear(size, size, bias=False)
        self.act = nn.SELU()
        self.drop = nn.Dropout(dropout_rate)
    def forward(self, x: torch.Tensor):
        return self.drop(x + self.act(self.ff(x)))

class ValueMLP(nn.Module):
    def __init__(self, n_layers, fp_dim, latent_dim, dropout_rate, device):
        super(ValueMLP, self).__init__()
        self.n_layers = n_layers
        self.fp_dim = fp_dim
        self.latent_dim = latent_dim
        self.dropout_rate = dropout_rate
        self.device = device

        logging.info('Initializing value model: latent_dim=%d' % self.latent_dim)

        layers = []
        layers.append(nn.Linear(fp_dim, latent_dim, bias=False))
        layers.append(nn.SELU())
        layers.append(nn.Dropout(self.dropout_rate))
        for _ in range(self.n_layers - 1):
            layers.append(Block(latent_dim, dropout_rate))
        layers.append(nn.Linear(latent_dim, 1, bias=False))

        self.layers = nn.Sequential(*layers)

    def forward(self, fps):
        x = fps
        x = self.layers(x)
        x = torch.log(1 + torch.exp(x))

        return x