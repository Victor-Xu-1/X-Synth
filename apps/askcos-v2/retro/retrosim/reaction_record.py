def get_reaction_smarts(reaction):
    if not reaction:
        return ""

    return reaction.get("reaction_smarts", "") or ""
