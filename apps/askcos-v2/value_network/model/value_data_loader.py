import os
import numpy as np
import torch
import pickle
import logging
from torch.utils.data import Dataset, DataLoader


'''
From Retro* - Binghong et.al 
https://github.com/binghong-ml/retro_star/blob/master/retro_star/data_loader/value_data_loader.py 
'''

def unpack_fps(packed_fps):
    if isinstance(packed_fps, torch.Tensor):
        packed_fps = packed_fps.cpu().numpy()
    fps = np.unpackbits(packed_fps, axis=-1)
    fps = torch.FloatTensor(fps)
    return fps

class ValueDataset(Dataset):
    def __init__(self, file_name):
        self.file_name = file_name
        data = np.load(file_name)

        logging.info('loading data')
        self.fps = unpack_fps(data['fps'])
        self.values = torch.from_numpy(data['values']).float()
        self.target_values = self.values
        self.reaction_costs = torch.from_numpy(data['r_costs'])
        self.reactant_fps = torch.from_numpy(data['r_fps'])
        self.reactant_masks = torch.from_numpy(data['r_masks'])


        assert self.fps.shape[0] == self.values.shape[0]
        logging.info('%d (fp, value) pairs loaded' % self.fps.shape[0])
        # print(self.fps.shape, self.values.shape)
        # if 'train' in self.file_name:
        #     logging.info('%d negative samples loaded' % self.reactant_fps.shape[0])
        #     print(self.reactant_fps.shape, self.reactant_masks.shape)

        logging.info(
            'mean: %f, std:%f, min: %f, max: %f, zeros: %f' %
            (self.values.mean(), self.values.std(), self.values.min(),
             self.values.max(), (self.values==0).sum()*1. / self.fps.shape[0])
        )

    def reshuffle(self):
        shuffle_idx = np.random.permutation(self.fps.shape[0])
        self.fps = self.fps[shuffle_idx]
        self.values = self.values[shuffle_idx]
        self.reaction_costs = self.reaction_costs[shuffle_idx]
        self.target_values = self.target_values[shuffle_idx]
        self.reactant_masks = self.reactant_masks[shuffle_idx]
        self.reactant_fps = self.reactant_fps[shuffle_idx]

    def __len__(self):
        return self.fps.shape[0]

    def __getitem__(self, index):
        return self.fps[index], self.values[index], \
               self.reaction_costs[index], self.target_values[index], \
               self.reactant_fps[index], self.reactant_masks[index]


class ValueDataLoader(DataLoader):
    def __init__(self, file_name, batch_size, shuffle=True):
        self.dataset = ValueDataset(file_name)

        super(ValueDataLoader, self).__init__(
            dataset=self.dataset,
            batch_size=batch_size,
            shuffle=shuffle
        )

    def reshuffle(self):
        self.dataset.reshuffle()
