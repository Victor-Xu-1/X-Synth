import { API } from "./api";
import { checkedReactionDraft, REACTION_DRAFT_PATH, REACTION_REQUEST_TIMEOUT_MS } from "./reaction-input";
import { runKetcherOperation } from "./ketcher-native-operations";

export const EMPTY_REACTION_CANVAS = JSON.stringify({
  root: {
    nodes: [
      {
        type: "arrow",
        data: {
          mode: "open-angle",
          pos: [
            { x: -2, y: 0, z: 0 },
            { x: 2, y: 0, z: 0 },
          ],
        },
      },
    ],
  },
});

export async function parseReactionText(content, api = API, { signal, timeoutMs = REACTION_REQUEST_TIMEOUT_MS } = {}) {
  const body = {
    format: "smiles",
    content: content.trim(),
    single_role: "product",
  };
  return checkedReactionDraft(await api.post(REACTION_DRAFT_PATH, body, false, { signal, timeoutMs }), body);
}

export async function parseCanvasReaction(content, compoundGroups, api = API, { signal, timeoutMs = REACTION_REQUEST_TIMEOUT_MS } = {}) {
  const body = { format: "rxn", content, single_role: "product" };
  if (
    compoundGroups &&
    Object.values(compoundGroups).some((records) => records.length)
  )
    body.compound_groups = compoundGroups;
  const response = await api.post(REACTION_DRAFT_PATH, body, false, { signal, timeoutMs });
  return checkedReactionDraft(response, body);
}

export class ReactionCanvasError extends Error {}

export async function readReactionCanvas(
  ketcher,
  compoundGroups,
  api = API,
  requiresArrow = false,
  { current = () => true } = {},
) {
  const content = await runKetcherOperation(ketcher, () => ketcher.getKet(), current);
  if (!current()) return null;
  const document = JSON.parse(content);
  if (!Array.isArray(document?.root?.nodes))
    throw new ReactionCanvasError("无法读取反应画板。");
  const arrows = document.root.nodes.filter((node) => node.type === "arrow");
  if (arrows.length > 1)
    throw new ReactionCanvasError("一次只能提交一个反应箭头。");
  if (!ketcher.editor.struct().atoms.size) return { text: "", kind: "empty" };
  if (!arrows.length) {
    if (requiresArrow)
      throw new ReactionCanvasError("反应箭头已删除，尚未确认反应角色。");
    return { text: await runKetcherOperation(ketcher, () => ketcher.getSmiles(true), current), kind: "molecule" };
  }
  // Ketcher 2.13 splits disconnected compounds. Restore only explicit, exact groups.
  const rxn = await runKetcherOperation(ketcher, () => ketcher.getRxn("v3000"), current);
  if (!current()) return null;
  const value = await parseCanvasReaction(
    rxn,
    compoundGroups,
    api,
  );
  return { text: value.reaction_smiles, kind: "reaction" };
}
