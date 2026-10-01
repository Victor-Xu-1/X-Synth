from wln_atommapper.atom_mapper import atom_mapper
from rdkit import Chem
import json
from functools import partial
import tqdm
from multiprocessing import Pool
from multiprocessing.managers import BaseManager

def read_file(data_path):
    # read the file
    with open(data_path, 'r') as f:
        data = f.read()
        data_string = data.split('\n')

        data_list_split = []
        # split the data into lsit
        for row in data_string:
            split = row.split('>>')
            try:
                data_list_split.append({'Reactant': split[0],
                                        'Product': split[1]})
            except:
                print(row)
    return data_list_split


def remove_atommap(smiles):
    mol = Chem.MolFromSmiles(smiles)
    for atom in mol.GetAtoms():
        atom.ClearProp('molAtomMapNumber')
    return Chem.MolToSmiles(mol)


def evaluation(data_row):
    mapper = atom_mapper()
    rct = data_row['Reactant']
    prd = remove_atommap(data_row['Product'])
    rct_am = ''
    prd_am = ''
    try:
        rct_am, prd_am = mapper.find_atom_map(rct, prd)
        if prd_am:
            success = True
        else:
            success = False
        print('Predicted: {}'.format(success))
    except:
        success = False
        print('Unpredicted: {}'.format(success))

    output = {'rct': rct,
              'prd': data_row['Product'],
              'rct_am': rct_am,
              'prd_am': prd_am}
    return output

class MyManager(BaseManager):
    pass

MyManager.register('MySharedClass', MySharedClass)


def parallel_eva(cpu_count, data):
    pool = Pool(processes=cpu_count, maxtasksperchild=10)  # if not set, it will use all the cpus ,
    chunksize = 1
    # imap returns an object which needs to be converted to list

    results = list(tqdm.tqdm(pool.imap(evaluation, data, chunksize), total=len(data)))
    pool.close()
    pool.join()

    return results


if __name__ == '__main__':

    # data = read_file('/home/yiming/Projects/data/wln_data/train.txt')
    data = read_file('/data/ymo/Projects/data/wln_data/train.txt')

    cpu_count = 30

    results = parallel_eva(cpu_count, data[0:60000:])
    with open('atommapp_eval.json', 'w') as f:
        json.dump(results, f)
