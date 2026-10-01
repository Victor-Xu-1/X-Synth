import csv
import sys
import os
from rdkit import Chem, RDLogger
RDLogger.DisableLog('rdApp.*') 
from multiprocessing import Pool
from model.parse_args import parser

def process_line(info):
    i, line = info
    if i % 100000 == 0: print(f"Processing {i} node")
    rxn = line['rxn_smiles']
    reac, prod = rxn.split(">>")
    reac_mol = Chem.MolFromSmiles(reac)
    prod_mol = Chem.MolFromSmiles(prod)

    if not reac_mol or not prod_mol:
        return None
    if reac_mol.GetNumHeavyAtoms() < 5 or prod_mol.GetNumHeavyAtoms() < 5:
        return None

    [a.ClearProp('molAtomMapNumber') for a in reac_mol.GetAtoms()]
    [a.ClearProp('molAtomMapNumber') for a in prod_mol.GetAtoms()]

    reac_smi = Chem.MolToSmiles(reac_mol)
    prod_smi = Chem.MolToSmiles(prod_mol)
    reac_smi = Chem.MolToSmiles(Chem.MolFromSmiles(reac_smi))
    prod_smi = Chem.MolToSmiles(Chem.MolFromSmiles(prod_smi))

    if reac_smi == prod_smi: return None

    return f"{reac_smi}>>{prod_smi}"

def main():
    args = parser.parse_args()
    os.makedirs(args.processed_folder, exist_ok=True)
    for phase in ("train", "val"):
        print(f"Parsing {phase} now....")

        if phase == "train": file = args.train_file
        if phase == "val": file = args.val_file
        with open(file, mode='r') as file:
            csvFile = csv.DictReader(file)
            lines = list(csvFile)

        with Pool(args.num_cores) as pool, open(f'{args.processed_folder}/{phase}_rxns.txt', 'w') as output:
            for result in pool.imap(process_line, (info for info in enumerate(lines))):
                if result:
                    output.write(result + "\n")

if __name__ == "__main__":
    main()
