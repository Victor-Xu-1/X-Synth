import { chemicalRecords, maxChemicalFileBytes } from "./chemical-files";

export const REACTION_DRAFT_PATH = "/api/v1/structure/reaction-draft";
export const MAX_REACTION_TEXT = 8192;
export const REACTION_REQUEST_TIMEOUT_MS = 15000;

function side(value, singleCompound = false) {
  if (Array.isArray(value))
    return value.map((text) => side(text, true)).join(".");
  if (typeof value !== "string") throw new Error("反应结构需要完整的 SMILES。");
  const text = value.trim();
  return singleCompound && text.includes(".") ? `(${text})` : text;
}
export function reactionInputText({
  reactants = "",
  product = "",
  agents = [],
} = {}) {
  const left = side(reactants),
    right = side(product, true),
    middle = side(agents);
  if (!left && !middle)
    return typeof product === "string" ? product.trim() : right;
  return `${left}>${middle}>${right}`;
}
export function reactionInputPrefill(query = {}) {
  const values = [query.reaction_smiles, query.rxnsmiles].filter(
    (value) => value !== undefined,
  );
  if (!values.length) return null;
  if (
    values.some(
      (value) =>
        typeof value !== "string" ||
        !value.trim() ||
        value.length > MAX_REACTION_TEXT,
    ) ||
    new Set(values).size !== 1
  )
    throw new Error("链接反应格式无效或存在冲突，未应用输入。");
  return values[0];
}
export function checkedReactionDraft(value, requested) {
  if (
    value?.format !== requested.format ||
    !["reaction", "molecule"].includes(value.input_kind) ||
    value.requested?.format !== requested.format ||
    value.requested?.content !== requested.content ||
    value.requested?.single_role !== requested.single_role ||
    typeof value.reaction_smiles !== "string" ||
    !value.reaction_smiles.trim() ||
    !Array.isArray(value.reactants) ||
    !Array.isArray(value.products) ||
    !Array.isArray(value.agents)
  )
    throw new Error("反应解析响应与当前输入不一致。");
  const records = (items) =>
    items.length ? chemicalRecords({ format: "mol", records: items }) : [];
  const parsed = {
    ...value,
    reactants: records(value.reactants),
    products: records(value.products),
    agents: records(value.agents),
  };
  const count =
    parsed.reactants.length + parsed.products.length + parsed.agents.length;
  for (const role of ["reactants", "products", "agents"])
    if (
      JSON.stringify(value.requested.compound_groups?.[role]) !==
      JSON.stringify(requested.compound_groups?.[role])
    )
      throw new Error("反应解析响应与化合物分组声明不一致。");
  if (!count || count > 100) throw new Error("反应结构记录不完整。");
  return parsed;
}
export async function reactionFileBody(file) {
  if (
    !file?.name?.toLowerCase().endsWith(".rxn") ||
    !file.size ||
    file.size > maxChemicalFileBytes
  )
    throw new Error("请选择不超过 2 MiB 的 MDL RXN 文件。");
  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
  } catch {
    throw new Error("反应文件需要是 UTF-8 编码的 MDL RXN 文本。");
  }
  return {
    format: "rxn",
    single_role: "product",
    content,
  };
}
