"""Concrete reaction drafts; role parsing and chemistry stay with RDKit."""

import math
import re
from typing import Literal

from rdkit import Chem, rdBase
from rdkit.Chem import rdChemReactions

from .chemical_files import (
    MAX_CHEMICAL_RECORDS,
    molecular_record,
)
from .chemical_reactions import reaction_file_molecules, reaction_records_block
from .reaction_compounds import restore_compound_groups
from .structure_validation import MAX_SMILES_LENGTH

ReactionDraftFormat = Literal["smiles", "rxn"]
SingleRole = Literal["product", "reactant"]
_ROLE_ORDER = ("reactants", "agents", "products")
_CX_FIELD = re.compile(
    r"(?P<fragments>f:[0-9]+(?:\.[0-9]+)*(?:,[0-9]+(?:\.[0-9]+)*)*)"
    r"|(?P<coordinates>\([^()]*\))"
    r"|(?P<labels>\$[^$]*\$)"
    r"|(?P<stereo>(?:a|&[0-9]+|o[0-9]+):[0-9]+(?:,[0-9]+)*)"
    r"|(?P<radicals>\^[0-7]:[0-9]+(?:,[0-9]+)*)"
)


def _smiles_text(content: str) -> tuple[str, str, list[tuple[str, str]]]:
    if not content or not content.strip() or "\x00" in content:
        raise ValueError("反应草稿必须包含化学结构。")
    if len(content.encode("utf-8")) > MAX_SMILES_LENGTH:
        raise ValueError("反应草稿超出 SMILES 长度范围。")
    text = content.strip()
    if "\n" in text or "\r" in text:
        raise ValueError("反应草稿仅支持一条 SMILES。")
    fields = text.split(maxsplit=1)
    notation = fields[0]
    cx_fields = []
    if len(fields) == 2:
        extensions = fields[1]
        if (
            not extensions.startswith("|")
            or not extensions.endswith("|")
            or extensions.count("|") != 2
        ):
            raise ValueError("SMILES 包含额外记录或无效 CXSMILES。")
        position = 1
        while position < len(extensions) - 1:
            field = _CX_FIELD.match(extensions, position)
            if field is None:
                raise ValueError("不支持该 CXSMILES 结构字段，未转换反应草稿。")
            if field.lastgroup == "stereo" and not field.group().startswith("a:"):
                raise ValueError("不支持相对/混合立体化学分组，未转换该结构。")
            cx_fields.append((field.lastgroup, field.group()))
            position = field.end()
            if position < len(extensions) - 1:
                if extensions[position] != ",":
                    raise ValueError("无效 CXSMILES 结构字段。")
                position += 1
                if position == len(extensions) - 1:
                    raise ValueError("无效 CXSMILES 结构字段。")
    return text, notation, cx_fields


def _cx_fragment_groups(groups: dict, fields: list[tuple[str, str]]) -> list[list[int]]:
    atom_count = sum(
        molecule.GetNumAtoms() for group in groups.values() for molecule in group
    )
    fragment_groups = []
    seen_fragments = False
    seen_atoms = {"stereo": set(), "radicals": set()}
    for kind, value in fields:
        if kind == "fragments":
            if seen_fragments:
                raise ValueError("CXSMILES 片段分组不能重复。")
            seen_fragments = True
            fragment_groups = [
                [int(index) for index in group.split(".")]
                for group in value[2:].split(",")
            ]
        elif kind == "coordinates":
            positions = value[1:-1].removesuffix(";").split(";") if value[1:-1] else []
            if len(positions) > atom_count:
                raise ValueError("CXSMILES 坐标超出实际原子范围。")
            for point in positions:
                coordinates = point.split(",")
                if not 2 <= len(coordinates) <= 3 or any(
                    not math.isfinite(float(coordinate or "0"))
                    for coordinate in coordinates
                ):
                    raise ValueError("CXSMILES 含有无效或非有限坐标。")
        elif kind == "labels":
            if any(value[1:-1].split(";")[atom_count:]):
                raise ValueError("CXSMILES 原子标签超出实际原子范围。")
        else:
            indices = [int(index) for index in value.partition(":")[2].split(",")]
            if (
                len(set(indices)) != len(indices)
                or any(index >= atom_count for index in indices)
                or seen_atoms[kind].intersection(indices)
            ):
                raise ValueError("CXSMILES 原子标记重复或越界。")
            seen_atoms[kind].update(indices)
    return fragment_groups


def _smiles_molecules(
    content: str, single_role: SingleRole, *, max_atoms: int
) -> tuple[str, dict]:
    text, notation, cx_fields = _smiles_text(content)
    groups = {role: [] for role in _ROLE_ORDER}
    if re.search(r"(?<!-)>", notation):
        reaction = rdChemReactions.ReactionFromSmiles(text)
        groups = {
            "reactants": list(reaction.GetReactants()),
            "agents": list(reaction.GetAgents()),
            "products": list(reaction.GetProducts()),
        }
        input_kind = "reaction"
    else:
        parameters = Chem.SmilesParserParams()
        parameters.parseName = False
        parameters.strictCXSMILES = True
        parameters.sanitize = False
        parameters.removeHs = False
        molecule = Chem.MolFromSmiles(text, parameters)
        if molecule is None or molecule.GetNumAtoms() == 0:
            raise ValueError("无法解析反应草稿中的确定结构。")
        groups["products" if single_role == "product" else "reactants"] = [molecule]
        input_kind = "molecule"
    fragment_groups = _cx_fragment_groups(groups, cx_fields)
    return input_kind, _group_fragments(groups, fragment_groups, max_atoms=max_atoms)


def _group_fragments(
    groups: dict, fragment_groups: list[list[int]], *, max_atoms: int
) -> dict:
    # RDKit reads CX metadata but does not apply reaction f: compound grouping.
    # Index its parsed fragments in R/A/P order; never split role notation ourselves.
    fragments = []
    records = {}
    for role in _ROLE_ORDER:
        for index, molecule in enumerate(groups[role]):
            key = (role, index)
            records[key] = set()
            for _ in Chem.GetMolFrags(molecule):
                records[key].add(len(fragments))
                fragments.append(key)
    merged = {}
    seen = set()
    for group in fragment_groups:
        if len(set(group)) != len(group) or any(
            index >= len(fragments) for index in group
        ):
            raise ValueError("CXSMILES 片段分组重复或越界。")
        keys = {fragments[index] for index in group}
        if len({role for role, _ in keys}) != 1:
            raise ValueError("CXSMILES 片段分组不能跨越反应角色。")
        members = set().union(*(records[key] for key in keys))
        if seen.intersection(members) or (len(keys) > 1 and members != set(group)):
            raise ValueError("CXSMILES 片段分组重叠或与已有化合物分组冲突。")
        if sum(groups[role][index].GetNumAtoms() for role, index in keys) > max_atoms:
            raise ValueError("CXSMILES 化合物分组超出当前原子数范围。")
        seen.update(members)
        first = min(keys)
        for key in keys:
            merged[key] = first
    result = {role: [] for role in _ROLE_ORDER}
    targets = {}
    for role in _ROLE_ORDER:
        for index, molecule in enumerate(groups[role]):
            key = merged.get((role, index), (role, index))
            if key not in targets:
                targets[key] = len(result[role])
                result[role].append(molecule)
            else:
                target = targets[key]
                result[role][target] = Chem.CombineMols(result[role][target], molecule)
    return result


def _record(molecule, *, index: int, max_atoms: int) -> dict:
    if molecule is None:
        return molecular_record(molecule, index=index, max_atoms=max_atoms)
    for conformer in molecule.GetConformers():
        if any(
            not math.isfinite(float(value))
            for point in conformer.GetPositions()
            for value in point
        ):
            raise ValueError("反应草稿含有非有限坐标，未转换该结构。")
    molecule = Chem.Mol(molecule)
    for atom in molecule.GetAtoms():
        if atom.HasProp("atomLabel") and re.fullmatch(
            r"_?R\d*", atom.GetProp("atomLabel")
        ):
            raise ValueError("反应草稿含有未定义的 R 基团。")
        atom.SetAtomMapNum(0)
    record = molecular_record(molecule, index=index, max_atoms=max_atoms)
    if not math.isfinite(record["molecular_weight"]):
        raise ValueError("反应草稿不能返回非有限结构记录。")
    return record


def _reaction_smiles(records: dict) -> str:
    reaction = rdChemReactions.ChemicalReaction()
    add_template = {
        "reactants": reaction.AddReactantTemplate,
        "agents": reaction.AddAgentTemplate,
        "products": reaction.AddProductTemplate,
    }
    fragment_groups = []
    index = 0
    for role in _ROLE_ORDER:
        for record in sorted(records[role], key=lambda value: value["smiles"]):
            molecule = Chem.MolFromSmiles(record["smiles"])
            fragments = sorted(
                Chem.MolToSmiles(fragment, isomericSmiles=True)
                for fragment in Chem.GetMolFrags(molecule, asMols=True)
            )
            if len(fragments) > 1:
                fragment_groups.append(
                    ".".join(
                        str(value) for value in range(index, index + len(fragments))
                    )
                )
            for fragment in fragments:
                add_template[role](Chem.MolFromSmiles(fragment))
            index += len(fragments)
    # Canonical compound/fragment ordering is explicit so f: also survives agents.
    # RDKit's parenthesized agent output is not accepted by its reaction reader.
    notation = rdChemReactions.ReactionToSmiles(reaction, canonical=False)
    if fragment_groups:
        notation += " |f:" + ",".join(fragment_groups) + "|"
    return notation


def parse_reaction_draft(
    content: str,
    format: ReactionDraftFormat,
    *,
    single_role: SingleRole = "product",
    compound_groups: dict | None = None,
    max_atoms: int,
) -> dict:
    if single_role not in {"product", "reactant"}:
        raise ValueError("单分子草稿必须指定为产物或反应物。")
    try:
        with rdBase.BlockLogs():
            if format == "smiles":
                input_kind, groups = _smiles_molecules(
                    content, single_role, max_atoms=max_atoms
                )
            elif format == "rxn":
                input_kind, groups = "reaction", reaction_file_molecules(content)
            else:
                raise ValueError("反应草稿仅支持 SMILES 和 MDL RXN。")
            count = sum(len(group) for group in groups.values())
            if not count or count > MAX_CHEMICAL_RECORDS:
                raise ValueError("反应草稿必须包含 1 至 100 条结构。")
            records = {
                role: [
                    _record(molecule, index=index, max_atoms=max_atoms)
                    for index, molecule in enumerate(groups[role], 1)
                ]
                for role in _ROLE_ORDER
            }
            if input_kind == "molecule":
                if compound_groups is not None:
                    raise ValueError("画板分组上下文只能用于 RXN 回读。")
                notation = records[
                    "products" if single_role == "product" else "reactants"
                ][0]["smiles"]
            else:
                if compound_groups is not None:
                    if format != "rxn":
                        raise ValueError("画板分组上下文只能用于 RXN 回读。")
                    records = restore_compound_groups(
                        records, compound_groups, max_atoms=max_atoms
                    )
                notation = _reaction_smiles(records)
            if len(notation.encode("utf-8")) > MAX_SMILES_LENGTH:
                raise ValueError("完整反应超出当前 SMILES 长度范围。")
            canvas_rxn = reaction_records_block(records)
            try:
                recovered = reaction_file_molecules(canvas_rxn)
                for role in _ROLE_ORDER:
                    identities = sorted(record["smiles"] for record in records[role])
                    restored = sorted(
                        _record(molecule, index=index, max_atoms=max_atoms)["smiles"]
                        for index, molecule in enumerate(recovered[role], 1)
                    )
                    if identities != restored:
                        raise ValueError("RXN identity mismatch")
            except ValueError as exc:
                raise ValueError(
                    "该立体化学或结构身份不能无损转换到反应画板。"
                ) from exc
    except (RuntimeError, ValueError) as exc:
        raise ValueError("反应草稿不能作为确定结构解析：" + str(exc)) from exc
    requested = {"format": format, "content": content, "single_role": single_role}
    if compound_groups is not None:
        requested["compound_groups"] = compound_groups
    return {
        "format": format,
        "input_kind": input_kind,
        "requested": requested,
        "reaction_smiles": notation,
        "canvas_rxn": canvas_rxn,
        **records,
    }
