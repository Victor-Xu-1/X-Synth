import json

# 10 % USPTO data gives 89.52% success rate
data = json.load(open('/home/yiming/Projects/data/atom_mapper/atommapp_eval_pistachio.json','r'))

count = 0
mapped_data = []
for row in data:
    if row['prd_am']:
        count += 1
        mapped_data.append(row)

successrate = count/len(data)