import pickle as pk
import os
import logging

with open("task_dict.pkl","rb") as file:
    task_dict = pk.load(file)
    for k, v in task_dict.items():
        print(k, v)
