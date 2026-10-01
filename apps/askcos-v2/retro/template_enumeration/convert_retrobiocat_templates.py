import yaml
import json


def main():
    fn = "data/rxns_yaml.yaml"
    with open(fn, "r") as f:
        raw_templates = yaml.safe_load(f)

    templates = []
    smarts_i = 0
    for reaction_name, metadata in raw_templates.items():
        enzymes = list(metadata["enzymes"].keys())
        reaction_smarts = metadata["smarts"]
        reaction_type = metadata["type"]

        for s in reaction_smarts:
            s = s.strip().replace("‘", "").replace("’", "")
            if ")>>(" in s:
                s = s[1:-1].replace(")>>(", ">>")
            template = {
                "_id": f"retrobiocat_{smarts_i}",
                "enzymes": enzymes,
                "reaction_smarts": s,
                "reaction_type": reaction_type,
                "template_set": "retrobiocat"
            }
            templates.append(template)
            smarts_i += 1

    ofn = "data/retro.templates.retrobiocat.json"
    with open(ofn, "w") as of:
        json.dump(templates, of)


if __name__ == "__main__":
    main()
