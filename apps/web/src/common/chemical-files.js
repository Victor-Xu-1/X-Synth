export const chemicalFileAccept = ".mol,.sdf,.sd,.smi,.smiles";
const formats = {
  mol: "mol",
  sdf: "sdf",
  sd: "sdf",
  smi: "smi",
  smiles: "smi",
};
export const maxChemicalFileBytes = 2 * 1024 * 1024;

export async function chemicalFileBody(file) {
  const format = formats[file?.name?.split(".").pop().toLowerCase()];
  if (!format)
    throw new Error(
      "请选择 MOL、SDF 或 SMILES 结构文件。CDX 文件需先转换为 MOL 或 SDF。",
    );
  if (!file.size || file.size > maxChemicalFileBytes)
    throw new Error("结构文件不能为空，大小不超过 2 MiB。");
  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
  } catch {
    throw new Error("结构文件不是 UTF-8 文本，请重新导出该文件。");
  }
  return { format, content };
}

export function chemicalRecords(value) {
  if (
    !formats[value?.format] ||
    !Array.isArray(value.records) ||
    !value.records.length ||
    value.records.length > 100
  )
    throw new Error("结构文件解析响应无效。");
  if (
    value.records.some(
      (record, index) =>
        record?.index !== index + 1 ||
        typeof record.name !== "string" ||
        record.name.length > 160 ||
        typeof record.smiles !== "string" ||
        !record.smiles.trim() ||
        record.smiles.length > 8192 ||
        !Number.isSafeInteger(record.components) ||
        record.components < 1 ||
        !Number.isSafeInteger(record.atoms) ||
        record.atoms < 1 ||
        typeof record.formula !== "string" ||
        !Number.isFinite(record.molecular_weight),
    )
  )
    throw new Error("结构文件记录不完整，未应用任何结构。");
  return value.records;
}

export function downloadChemicalFile(value, filename = "compound") {
  if (
    !["mol", "sdf", "smi", "rxn"].includes(value?.format) ||
    typeof value.content !== "string" ||
    !value.content ||
    value.content.length > maxChemicalFileBytes
  )
    throw new Error("化学结构导出响应无效。");
  const blob = new Blob([value.content], {
    type: value.media_type || "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "compound"}.${value.format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
