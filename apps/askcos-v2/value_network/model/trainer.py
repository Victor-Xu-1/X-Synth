import os
import numpy as np
import torch
import torch.optim as optim
import torch.nn.functional as F
from tqdm import tqdm
import logging
from model.value_data_loader import unpack_fps

'''
From Retro* - Binghong et.al 
https://github.com/binghong-ml/retro_star/blob/master/retro_star/trainer/trainer.py
'''

class Trainer:
    def __init__(self, args, model, train_data_loader, val_data_loader):
        self.train_data_loader = train_data_loader
        self.val_data_loader = val_data_loader
        self.n_epochs = args.n_epochs
        self.lr = args.lr
        self.save_epoch_int = args.save_epoch_int
        self.model_folder = args.checkpoints_folder
        self.device = args.device
        self.model = model.to(self.device)

        os.makedirs(self.model_folder, exist_ok=True)

        self.optim = optim.Adam(
            filter(lambda p: p.requires_grad, self.model.parameters()),
            lr=self.lr
        )
        self.scheduler = optim.lr_scheduler.ReduceLROnPlateau(
            optimizer=self.optim,
            factor=args.lr_scheduler_factor,
            patience=args.lr_scheduler_patience,
            cooldown=args.lr_cooldown,
            verbose=True,
        )



    def _pass(self, data, train=True):
        self.optim.zero_grad()

        for i in range(len(data)):
            data[i] = data[i].to(self.device)


        fps, values, r_costs, t_values, r_fps, r_masks = data
        r_fps = unpack_fps(r_fps).to(fps)
        r_masks = unpack_fps(r_masks).to(fps)

        v_pred = self.model(fps).squeeze()

        D_MAX = 5
        losses = []
        for pred, gt in zip(v_pred, values):
            if gt <= D_MAX: 
                loss = F.mse_loss(pred, gt)
            else:
                loss = torch.max(torch.Tensor([0, D_MAX + 1 - pred]).to(gt)) ** 2
            losses.append(loss)
        loss = torch.mean(torch.stack(losses))


        batch_size, n_reactants, fp_dim = r_fps.shape
        # r_fps = r_fps * r_masks
        r_values = self.model(r_fps.view(-1, fp_dim)).squeeze()
        r_values = r_values.view(batch_size, n_reactants)
        r_values = r_values * r_masks.sum(dim=-1)

        # r_values = torch.sum(r_values, dim=1, keepdim=True)
        r_values = torch.sum(r_values, dim=1)

        """
        r_values:   sum of reactant values in a negative reaction sample
        r_costs:    reaction cost
        t_values:   true product value
        7. (const): margin, -log(1e-3)
        """

        r_gap = - r_values - r_costs + t_values + 7.
        r_gap = torch.clamp(r_gap, min=0)
        loss += (r_gap**2).mean()

        if train:
            loss.backward()
            self.optim.step()
        # else:
        #     self.scheduler.step(loss)

        return loss.item()

    def _train_epoch(self):
        self.model.train()

        losses = []
        pbar = tqdm(self.train_data_loader)
        for data in pbar:
            loss = self._pass(data)
            losses.append(loss)
            pbar.set_description('[loss: %f]' % (loss))

        return np.array(losses).mean()

    def _val_epoch(self):
        self.model.eval()

        losses = []
        pbar = tqdm(self.val_data_loader)
        for data in pbar:
            loss = self._pass(data, train=False)
            losses.append(loss)
            pbar.set_description('[loss: %f]' % (loss))

        return np.array(losses).mean()

    def train(self):
        best_val_loss = np.inf
        for epoch in range(self.n_epochs):
            self.train_data_loader.reshuffle()

            train_loss = self._train_epoch()
            val_loss = self._val_epoch()
            logging.info(
                '[Epoch %d/%d] [training loss: %f] [validation loss: %f]' %
                (epoch, self.n_epochs, train_loss, val_loss)
            )

            # if val_loss < best_val_loss or epoch==self.n_epochs-1:
            #     best_val_loss = val_loss
            #     save_file = self.model_folder + '/best_epoch_%d.pt' % epoch
            #     torch.save(self.model.state_dict(), save_file)

            if (epoch + 1) % self.save_epoch_int == 0:
                save_file = self.model_folder + '/epoch_%d.pt' % epoch
                torch.save(self.model.state_dict(), save_file)