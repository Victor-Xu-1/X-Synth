import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { serialize, deserialize } from "node:v8";
import { useReactionDraft } from "./useReactionDraft";
globalThis.structuredClone ||= value => deserialize(serialize(value));

// These fixtures test transport/lifecycle, not chemical parsing or experimental feasibility.
const source = "CCO>O.O.O.O>CC=O";
const compound = (smiles, index, components = 1) => ({ index, name: "", smiles, components,
  atoms: 3, formula: "protocol fixture", molecular_weight: 46 });
const records = () => ({ reactants: [compound("CCO", 1)], products: [compound("CC=O", 1)],
  agents: Array.from({ length: 4 }, (_, index) => compound("O", index + 1)) });
const draftResponse = (body, values = records()) => ({ format: body.format, input_kind: "reaction", requested: body,
  reaction_smiles: source, canvas_rxn: "$RXN original protocol fixture", ...values });
function ket(componentCount = 6) {
  const document = { root: { nodes: [] } };
  for (let index = 0; index < componentCount; index++) {
    document.root.nodes.push({ $ref: `mol${index}` });
    document[`mol${index}`] = { type: "molecule", atoms: [{ label: "C", location: [index * 3, 3, 0] }] };
  }
  document.root.nodes.push({ type: "arrow", data: { pos: [{ x: 1, y: 0, z: 0 }, { x: 18, y: 0, z: 0 }] } });
  return JSON.stringify(document);
}
const wrappers = [];
function setup(api, textValue = source) {
  let state;
  const text = ref(textValue), boardPending = ref(false);
  const wrapper = mount(defineComponent({ setup() {
    state = useReactionDraft({ text, boardPending, requireReactants: () => false, api });
    return () => null;
  } }));
  wrappers.push(wrapper);
  return { state, text };
}
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));

test("initial compaction verifies actual returned roles before releasing its write transaction", async () => {
  const api = { post: jest.fn(async (_, body) => draftResponse(body)) };
  const { state, text } = setup(api);
  await state.prepareContent(source);
  const ketcher = { getKet: jest.fn(async () => ket()), getRxn: jest.fn(async () => "$RXN compact protocol fixture") };
  const write = jest.fn(async () => true), signal = new AbortController().signal;
  await state.layoutImported({ ketcher, source, write, current: () => true, signal });
  expect(write).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledTimes(2);
  expect(api.post.mock.calls[1][1]).toEqual({ format: "rxn", content: "$RXN compact protocol fixture", single_role: "product" });
  expect(api.post.mock.calls[1][3]).toEqual({ signal, timeoutMs: 15000 });
  expect(text.value).toBe(source);
});

test("changed role identities restore the original RXN and still report failure", async () => {
  const api = { post: jest.fn(async (_, body) => {
    if (body.format === "smiles") return draftResponse(body);
    const altered = records(); altered.reactants.push(compound("O", 2)); altered.agents.pop();
    return draftResponse(body, altered);
  }) };
  const { state, text } = setup(api); await state.prepareContent(source);
  const ketcher = { getKet: async () => ket(), getRxn: async () => "$RXN changed protocol fixture" };
  const write = jest.fn(async () => true);
  await expect(state.layoutImported({ ketcher, source, write, current: () => true, signal: new AbortController().signal })).rejects.toThrow("结构身份");
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[1][0]).toBe("$RXN original protocol fixture");
  expect(text.value).toBe(source);
});

test("superseded verification never restores an old canvas or checks its old returned result", async () => {
  let release, current = true;
  const api = { post: jest.fn(async (_, body) => body.format === "smiles" ? draftResponse(body)
    : new Promise(resolve => { release = () => resolve(draftResponse(body)); })) };
  const { state } = setup(api); await state.prepareContent(source);
  const write = jest.fn(async () => true);
  const operation = state.layoutImported({ ketcher: { getKet: async () => ket(), getRxn: async () => "$RXN protocol" },
    source, write, current: () => current, signal: new AbortController().signal });
  await flushPromises(); expect(release).toBeDefined();
  current = false; release(); await operation;
  expect(write).toHaveBeenCalledTimes(1);
});

test("fresh declared disconnected compound groups are included in the verification request", async () => {
  const grouped = records(); grouped.reactants = [compound("[Na+].[Cl-]", 1, 2)];
  const api = { post: jest.fn(async (_, body) => draftResponse(body, grouped)) };
  const { state } = setup(api); await state.prepareContent(source);
  await state.layoutImported({ ketcher: { getKet: async () => ket(7), getRxn: async () => "$RXN salt" },
    source, write: async () => true, current: () => true, signal: new AbortController().signal });
  expect(api.post.mock.calls[1][1].compound_groups).toEqual({ reactants: ["[Na+].[Cl-]"], products: [], agents: [] });
});

test("small or incomplete drafts require no additional native serialization or verification call", async () => {
  const values = records(); values.agents = values.agents.slice(0, 1);
  const api = { post: jest.fn(async (_, body) => draftResponse(body, values)) };
  const { state } = setup(api); await state.prepareContent(source);
  const ketcher = { getKet: jest.fn() }, write = jest.fn();
  await state.layoutImported({ ketcher, source, write, current: () => true, signal: new AbortController().signal });
  expect(ketcher.getKet).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  expect(api.post).toHaveBeenCalledTimes(1);
});
