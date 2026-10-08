export const chemicalFileAccept = ".mol,.sdf,.sd,.smi,.smiles";
const formats = {
  mol: "mol",
  sdf: "sdf",
  sd: "sdf",
  smi: "smi",
  smiles: "smi",
};
export const maxChemicalFileBytes = 2 * 1024 * 1024;
const moleculeFormats = ["mol", "sdf", "smi"];
const mediaTypes = {
  mol: "chemical/x-mdl-molfile",
  sdf: "chemical/x-mdl-sdfile",
  smi: "chemical/x-daylight-smiles",
  rxn: "chemical/x-mdl-rxnfile",
};

export class ChemicalFileError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChemicalFileError";
  }
}

async function readFile(file, signal, timeoutMs) {
  if (signal?.aborted) throw signal.reason;
  let timer, abort;
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => reject(new ChemicalFileError("结构文件解析失败。")), timeoutMs);
      Promise.resolve().then(() => {
        if (signal?.aborted) throw signal.reason;
        return file.arrayBuffer();
      }).then(resolve, reject);
    });
  } catch (error) {
    if (signal?.aborted || error instanceof ChemicalFileError) throw error;
    throw new ChemicalFileError("结构文件解析失败。");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function chemicalFileBody(file, { signal, timeoutMs = 15000 } = {}) {
  const extension = file?.name?.split(".").pop().toLowerCase();
  const format = Object.hasOwn(formats, extension) ? formats[extension] : null;
  if (!format)
    throw new ChemicalFileError(
      "请选择 MOL、SDF 或 SMILES 结构文件。CDX 文件需先转换为 MOL 或 SDF。",
    );
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > maxChemicalFileBytes)
    throw new ChemicalFileError("结构文件不能为空，大小不超过 2 MiB。");
  const buffer = await readFile(file, signal, timeoutMs);
  if (!buffer.byteLength || buffer.byteLength > maxChemicalFileBytes)
    throw new ChemicalFileError("结构文件不能为空，大小不超过 2 MiB。");
  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new ChemicalFileError("结构文件不是 UTF-8 文本，请重新导出该文件。");
  }
  if (!content.trim())
    throw new ChemicalFileError("结构文件不能为空，大小不超过 2 MiB。");
  return { format, content };
}

export function chemicalRecords(value, expectedFormat) {
  if (
    !moleculeFormats.includes(value?.format) ||
    (expectedFormat !== undefined && value.format !== expectedFormat) ||
    !Array.isArray(value.records) ||
    !value.records.length ||
    value.records.length > 100
  )
    throw new ChemicalFileError("结构文件解析响应无效。");
  if (
    value.records.some(
      (record, index) =>
        record?.index !== index + 1 ||
        typeof record.name !== "string" ||
        record.name.length > 160 ||
        /[\r\n\0]/.test(record.name) ||
        typeof record.smiles !== "string" ||
        !record.smiles.trim() ||
        record.smiles.length > 8192 ||
        !Number.isSafeInteger(record.components) ||
        record.components < 1 ||
        !Number.isSafeInteger(record.atoms) ||
        record.atoms < 1 ||
        record.components > record.atoms ||
        typeof record.formula !== "string" ||
        !record.formula.trim() ||
        !Number.isFinite(record.molecular_weight) ||
        record.molecular_weight <= 0,
    )
  )
    throw new ChemicalFileError("结构文件记录不完整，未应用任何结构。");
  return value.records;
}

export function chemicalStructureIdentity(value) {
  if (value?.valid !== true || typeof value.smiles !== "string" || !value.smiles.trim() ||
    value.smiles.length > 8192 || !Number.isSafeInteger(value.atoms) || value.atoms < 1)
    throw new ChemicalFileError("化合物结构无效。");
  return value.smiles;
}

export function downloadChemicalFile(value, filename = "compound", expectedFormat) {
  if (
    !Object.hasOwn(mediaTypes, value?.format) ||
    (expectedFormat !== undefined && value.format !== expectedFormat) ||
    typeof value.content !== "string" ||
    !value.content ||
    value.content.length > maxChemicalFileBytes
  )
    throw new ChemicalFileError("化学结构导出响应无效。");
  const blob = new Blob([value.content], {
    type: mediaTypes[value.format],
  });
  if (blob.size > maxChemicalFileBytes)
    throw new ChemicalFileError("化学结构导出响应无效。");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const safeName = Array.from(filename.replace(/[<>:"/\\|?*]/g, "_"),
    (character) => character.codePointAt(0) < 32 ? "_" : character).join("");
  let stem = safeName.replace(/\.(mol|sdf|sd|smi|smiles|rxn)$/i, "")
    .slice(0, 200).replace(/[. ]+$/, "");
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
  link.download = `${stem || "compound"}.${value.format}`;
  try {
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
