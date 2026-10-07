"""Display-only labels for generalized SMARTS query atoms."""


def check_atom_for_generalization(atom):
    smarts = atom.GetSmarts()
    if "#" in smarts:
        label = f"[{atom.GetSymbol()}]"
    elif "[C:" in smarts and "H" not in smarts:
        label = "C[al]"
    elif "[c:" in smarts and "H" not in smarts:
        label = "C[ar]"
    else:
        label = None
    if label:
        # A display label must not make the atomic number contradict the query.
        atom.SetProp("atomLabel", label)
    if ":0]" in smarts:
        atom.ClearProp("molAtomMapNumber")
