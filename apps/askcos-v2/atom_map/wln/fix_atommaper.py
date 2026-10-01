from wln_predictor.template_free import TemplateFreeNeuralNetScorer as TFFP
from wln_atommapper.template_free import TemplateFreeNeuralNetScorer as TFFP_AM

import pandas as pd


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

test = read_file('/home/yiming/Projects/data/wln_data/test.txt')
predictor = TFFP()
mapper = TFFP_AM()

for i in range(32, len(test)):
    rct = test[i]['Reactant']
    print('Test {}: {}'.format(i, rct))
    pred_outcome = predictor.evaluate(rct)
    s, map_outcome = mapper.evaluate(rct)

    for j, outcome in enumerate(pred_outcome[0]):
        try:
            if outcome['outcome']['smiles'] != map_outcome[0][j]['outcome']['smiles']:
                print('Case {}:'.format(j))
                print('Predictor smiles: {}'.format(outcome['outcome']['smiles']))
                print('Mapper smiles: {}'.format(map_outcome[0][j]['outcome']['smiles']))
        except :
            print('some products have problems')
            break


    if i > 60:
        break
