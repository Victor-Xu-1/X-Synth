"""Bounded chemical-file interchange, without stripping salts or stereochemistry."""

import io
from typing import Literal

from rdkit import Chem, rdBase
from rdkit.Chem import Descriptors, rdDepictor, rdMolDescriptors

from .structure_validation import MAX_SMILES_LENGTH, canonical_structure

ChemicalFormat = Literal["mol", "sdf", "smi"]
MAX_CHEMICAL_FILE_BYTES = 2 * 1024 * 1024
MAX_CHEMICAL_RECORDS = 100


def chemical_text(content: str) -> str:
    if not content or not content.strip():
        raise ValueError("化学文件为空。")
    if "\x00" in content or len(content.encode("utf-8")) > MAX_CHEMICAL_FILE_BYTES:
        raise ValueError("化学文件必须为文本，大小不超过 2 MiB。")
    return content.removeprefix("\ufeff").replace("\r\n", "\n")


def molecular_record(molecule, *, index: int, max_atoms: int) -> dict:
    if molecule is None or molecule.GetNumAtoms() == 0:
        raise ValueError(f"第 {index} 条结构无法解析。")
    if molecule.GetNumAtoms() > max_atoms:
        raise ValueError(f"第 {index} 条结构超出当前原子数范围。")
    if any(atom.HasQuery() or atom.GetAtomicNum() == 0 for atom in molecule.GetAtoms()):
        raise ValueError(f"第 {index} 条含有查询原子或未定义的 R 基团。")
    if any(bond.HasQuery() for bond in molecule.GetBonds()):
        raise ValueError(f"第 {index} 条含有查询键，不能作为确定结构。")
    if any(
        group.GetGroupType() != Chem.StereoGroupType.STEREO_ABSOLUTE
        for group in molecule.GetStereoGroups()
    ):
        raise ValueError("当前路线模型不支持相对/混合立体化学分组，未转换该结构。")
    if any(
        group.GetProp("TYPE") != "SUP" for group in Chem.GetMolSubstanceGroups(molecule)
    ):
        raise ValueError("当前路线模型不支持聚合物或混合物 S-group。")
    try:
        Chem.SanitizeMol(molecule)
        molecule = Chem.RemoveHs(molecule)
        smiles, atoms = canonical_structure(
            Chem.MolToSmiles(molecule, isomericSmiles=True), max_atoms=max_atoms
        )
        formula = rdMolDescriptors.CalcMolFormula(molecule)
        mass = Descriptors.MolWt(molecule)
    except (ValueError, RuntimeError) as exc:
        raise ValueError(f"第 {index} 条结构价态或立体化学无效。") from exc
    name = molecule.GetProp("_Name") if molecule.HasProp("_Name") else ""
    if len(name) > 160 or any(char in name for char in "\r\n\x00"):
        raise ValueError(f"第 {index} 条化合物名称过长或包含换行。")
    return {
        "index": index,
        "name": name,
        "smiles": smiles,
        "atoms": atoms,
        "components": len(Chem.GetMolFrags(molecule)),
        "formula": formula,
        "molecular_weight": round(mass, 4),
    }


def parse_chemical_file(
    content: str, format: ChemicalFormat, *, max_atoms: int
) -> dict:
    text = chemical_text(content)
    records = []
    with rdBase.BlockLogs():
        if format == "mol":
            if "$$$$" in text or text.lstrip().startswith("$RXN"):
                raise ValueError(
                    "该文件不是单个 MOL 结构，请选择对应的 SDF 或 RXN 入口。"
                )
            lines = text.splitlines()
            ends = [
                index
                for index, line in enumerate(lines)
                if index >= 4 and line == "M  END"
            ]
            if len(ends) != 1 or any(line.strip() for line in lines[ends[0] + 1 :]):
                raise ValueError("MOL 文件包含额外或不完整记录，未导入任何结构。")
            molecules = [
                Chem.MolFromMolBlock(
                    text, sanitize=False, removeHs=False, strictParsing=True
                )
            ]
        elif format == "sdf":
            supplier = Chem.ForwardSDMolSupplier(
                io.BytesIO(text.encode("utf-8")),
                sanitize=False,
                removeHs=False,
                strictParsing=True,
            )
            supplier.SetProcessPropertyLists(False)
            molecules = supplier
        elif format == "smi":
            molecules = _smiles_records(text)
        else:
            raise ValueError("仅支持 MOL、SDF 和 SMILES 结构文件。")
        for index, molecule in enumerate(molecules, 1):
            if index > MAX_CHEMICAL_RECORDS:
                raise ValueError("单次导入最多 100 条结构，文件未导入，请拆分后重试。")
            records.append(molecular_record(molecule, index=index, max_atoms=max_atoms))
    if not records:
        raise ValueError("文件中没有可解析的化学结构。")
    return {"format": format, "records": records}


def _smiles_records(text):
    parameters = Chem.SmilesParserParams()
    parameters.parseName = False
    parameters.allowCXSMILES = False
    parameters.sanitize = False
    parameters.removeHs = False
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        fields = line.split(maxsplit=1)
        if len(fields[0].encode("utf-8")) > MAX_SMILES_LENGTH:
            raise ValueError("SMILES 记录过长，未导入该文件。")
        molecule = Chem.MolFromSmiles(fields[0], parameters)
        if molecule is not None and len(fields) == 2:
            molecule.SetProp("_Name", fields[1])
        yield molecule


def export_chemical_file(
    smiles: str, format: ChemicalFormat, *, name: str, max_atoms: int
) -> dict:
    canonical, _ = canonical_structure(smiles, max_atoms=max_atoms)
    if len(name) > 160 or any(char in name for char in "\r\n\x00"):
        raise ValueError("化合物名称不能包含换行或超过 160 个字符。")
    with rdBase.BlockLogs():
        molecule = Chem.MolFromSmiles(canonical)
        # Refuse chemistry the file reader cannot faithfully accept on re-import.
        molecular_record(molecule, index=1, max_atoms=max_atoms)
        if format == "smi":
            content = canonical + (f"\t{name}" if name else "") + "\n"
            media_type = "chemical/x-daylight-smiles"
        elif format in {"mol", "sdf"}:
            molecule.SetProp("_Name", name)
            rdDepictor.Compute2DCoords(molecule)
            content = Chem.MolToMolBlock(molecule, includeStereo=True)
            if format == "sdf":
                content += "$$$$\n"
            # Export is not successful if it would change the molecular identity.
            recovered = Chem.MolFromMolBlock(content.split("$$$$")[0], removeHs=False)
            record = molecular_record(recovered, index=1, max_atoms=max_atoms)
            if record["smiles"] != canonical:
                raise ValueError("该结构不能无损导出为选定格式。")
            media_type = (
                "chemical/x-mdl-molfile" if format == "mol" else "chemical/x-mdl-sdfile"
            )
        else:
            raise ValueError("不支持的化学结构导出格式。")
    return {
        "format": format,
        "smiles": canonical,
        "content": content,
        "media_type": media_type,
    }
