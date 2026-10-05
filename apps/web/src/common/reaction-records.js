import { checkedReactionDraft, REACTION_DRAFT_PATH } from "./reaction-input";
import { maxChemicalFileBytes } from "./chemical-files";

export const REACTION_EXPORT_PATH = "/api/v1/structure/reaction-export";
const roles = ["reactants", "products", "agents"];
export class ReactionRecordsError extends Error {}

export function reactionRecordsBody(value) {
  const body = Object.fromEntries(
    roles.map((role) => [
      role,
      [...(Array.isArray(value?.[role]) ? value[role] : [])],
    ]),
  );
  if (
    roles.some(
      (role) =>
        !Array.isArray(value?.[role]) ||
        body[role].some(
          (smiles) =>
            typeof smiles !== "string" ||
            !smiles.trim() ||
            smiles.length > 8192,
        ),
    ) ||
    !body.reactants.length ||
    !body.products.length ||
    roles.reduce((count, role) => count + body[role].length, 0) > 100
  )
    throw new ReactionRecordsError("参考反应结构记录不完整，未改变画板。");
  return body;
}

export function matchingReactionRecords(draft, expected) {
  return roles.every(
    (role) =>
      JSON.stringify(draft[role].map((record) => record.smiles).sort()) ===
      JSON.stringify([...expected[role]].sort()),
  );
}

export async function exportedReactionDraft(body, api, current = () => true) {
  const output = await api.post(REACTION_EXPORT_PATH, body);
  if (!current()) return null;
  if (
    output?.format !== "rxn" ||
    typeof output.content !== "string" ||
    !output.content.startsWith("$RXN") ||
    output.content.length > maxChemicalFileBytes
  )
    throw new ReactionRecordsError("完整反应导出响应无效，未改变画板。");
  const requested = {
    format: "rxn",
    content: output.content,
    single_role: "product",
  };
  const value = checkedReactionDraft(
    await api.post(REACTION_DRAFT_PATH, requested),
    requested,
  );
  if (!current()) return null;
  if (!matchingReactionRecords(value, body))
    throw new ReactionRecordsError(
      "导出的反应结构与参考记录不一致，未改变画板。",
    );
  return value;
}
