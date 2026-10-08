import { defineComponent } from "vue";
import { randomUUID } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import { mount } from "@vue/test-utils";
import { API } from "@/common/api";
import { useRouteDocument } from "./useRouteDocument";
import { graphFromCandidate } from "@/common/route-graph";
import { reactionForNode } from "@/common/route-node-context";

jest.mock("@/common/api", () => ({
  API: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));
Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID });
globalThis.structuredClone = (value) => deserialize(serialize(value));

const wrappers = [];
const documentValue = (id = "a".repeat(32)) => ({
  id,
  title: "路线文档",
  state: "source_copy",
  revision: 3,
  prediction_scores: { "r-1": 0.9 },
  graph: {
    target_id: "target",
    nodes: [
      {
        id: "target",
        type: "molecule",
        smiles: "CCO",
        position: { x: 20, y: 20 },
      },
    ],
    edges: [],
  },
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
async function setup() {
  let state;
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useRouteDocument();
        return () => null;
      },
    }),
  );
  wrappers.push(wrapper);
  API.get.mockResolvedValue(documentValue());
  await state.load("a".repeat(32));
  return state;
}
beforeEach(() => jest.clearAllMocks());
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("selected reaction occurrences survive editing, undo, save-copy and reload", async () => {
  const state = await setup();
  const precursors = [
    "OCCBr", "OCCBr", "[13CH3][C@H]([NH3+])C(=O)[O-].[Na+]",
  ];
  const graph = graphFromCandidate({
    target_smiles: "[13CH3][C@H](N)CO",
    steps: [{ product: "[13CH3][C@H](N)CO", precursors }],
  });
  state.replaceGraph(graph);
  state.selected.value = "r-1";
  expect(reactionForNode(state.graph.value, state.selectedNode.value).precursors)
    .toEqual(precursors);
  state.undo();
  expect(state.graph.value.edges).toEqual([]);
  state.redo();
  API.post.mockImplementation(async (_, body) => ({
    ...documentValue("b".repeat(32)), ...body, state: "draft", revision: 0,
  }));
  const saved = await state.save(true);
  expect(API.post.mock.calls[0][1].graph.edges[0].input_occurrences).toBe(2);
  expect(state.dirty.value).toBe(false);
  API.get.mockResolvedValue(saved);
  await state.load(saved.id);
  state.selected.value = "r-1";
  expect(reactionForNode(state.graph.value, state.selectedNode.value).precursors)
    .toEqual(precursors);
});

test("adding a validated molecule is one undoable draft edit and preserves the revision lock", async () => {
  const state = await setup();
  API.post.mockResolvedValue({ smiles: "[NH3+]CCO.[Cl-]" });
  expect(await state.addMolecule("OCCN.Cl")).toBe(true);
  expect(state.graph.value.nodes).toHaveLength(2);
  expect(state.graph.value.nodes[1].smiles).toBe("[NH3+]CCO.[Cl-]");
  expect(state.undoStack.value).toHaveLength(1);
  expect(state.dirty.value).toBe(true);
  expect(state.scores.value).toEqual({});
  API.put.mockImplementation(async (_, body) => ({
    ...documentValue(),
    ...body,
    state: "draft",
    revision: 4,
  }));
  await state.save();
  expect(API.put.mock.calls[0][1].revision).toBe(3);
  expect(state.dirty.value).toBe(false);
  expect(state.document.value.state).toBe("draft");
  state.undo();
  expect(state.graph.value.nodes).toHaveLength(1);
  state.redo();
  expect(state.graph.value.nodes).toHaveLength(2);
});

test.each(["resolve", "reject"])(
  "molecule validation cannot write or report errors into another document on late %s",
  async (result) => {
    const state = await setup();
    const request = deferred();
    API.post.mockReturnValueOnce(request.promise);
    const pending = state.addMolecule("O");
    API.get.mockResolvedValue(documentValue("b".repeat(32)));
    await state.load("b".repeat(32));
    request[result](
      result === "resolve" ? { smiles: "O" } : new Error("old request"),
    );
    expect(await pending).toBe(false);
    expect(state.graph.value.nodes).toHaveLength(1);
    expect(state.document.value.id).toBe("b".repeat(32));
    expect(state.error.value).toBe("");
    expect(state.validating.value).toBe(false);
  },
);

test("cancelled molecule input and unmounted documents ignore a successful late validation", async () => {
  const state = await setup();
  const request = deferred();
  API.post.mockReturnValueOnce(request.promise);
  const pending = state.addMolecule("O");
  state.cancelValidation();
  request.resolve({ smiles: "O" });
  expect(await pending).toBe(false);
  expect(state.dirty.value).toBe(false);
  const next = deferred();
  API.post.mockReturnValueOnce(next.promise);
  const late = state.addMolecule("N");
  wrappers[0].unmount();
  wrappers.splice(0, 1);
  next.resolve({ smiles: "N" });
  expect(await late).toBe(false);
  expect(state.graph.value.nodes).toHaveLength(1);
});

test("a stale new-document validation cannot create or navigate after opening another document", async () => {
  const state = await setup();
  state.clear();
  const request = deferred();
  API.post.mockReturnValueOnce(request.promise);
  const pending = state.create("O", "目标");
  API.get.mockResolvedValue(documentValue("b".repeat(32)));
  await state.load("b".repeat(32));
  request.resolve({ smiles: "O" });
  expect(await pending).toBeNull();
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(state.document.value.id).toBe("b".repeat(32));
});

test("a stale save conflict cannot overwrite the new document's state or error", async () => {
  const state = await setup();
  const request = deferred();
  API.put.mockReturnValueOnce(request.promise);
  const pending = state.save();
  API.get.mockResolvedValue(documentValue("b".repeat(32)));
  await state.load("b".repeat(32));
  request.reject(new Error("old revision conflict"));
  expect(await pending).toBeNull();
  expect(state.error.value).toBe("");
  expect(state.saving.value).toBe(false);
});

test("a previous save response cannot release a newer document's save lock", async () => {
  const state = await setup();
  const previous = deferred();
  API.put.mockReturnValueOnce(previous.promise);
  const oldSave = state.save();
  API.get.mockResolvedValue(documentValue("b".repeat(32)));
  await state.load("b".repeat(32));
  const current = deferred();
  API.put.mockReturnValueOnce(current.promise);
  const newSave = state.save();
  previous.resolve(documentValue());
  expect(await oldSave).toBeNull();
  expect(state.saving.value).toBe(true);
  expect(state.document.value.id).toBe("b".repeat(32));
  current.resolve({ ...documentValue("b".repeat(32)), revision: 4 });
  await newSave;
  expect(state.saving.value).toBe(false);
  expect(state.document.value.revision).toBe(4);
});

test("malformed canonical structures cannot add empty material entries", async () => {
  const state = await setup();
  API.post.mockResolvedValue({ smiles: "" });
  expect(await state.addMolecule("O")).toBe(false);
  expect(state.graph.value.nodes).toHaveLength(1);
  expect(state.undoStack.value).toHaveLength(0);
  expect(state.dirty.value).toBe(false);
});

const invalidDocument = (failure) => {
  const value = documentValue();
  if (failure === "different document") value.id = "b".repeat(32);
  else if (failure === "missing position") delete value.graph.nodes[0].position;
  else if (failure === "missing target") value.graph.target_id = "missing";
  else if (failure === "invalid revision") value.revision = -1;
  else if (failure === "null scores") value.prediction_scores = null;
  return value;
};
test.each(["different document", "missing position", "missing target", "invalid revision", "null scores"])(
  "loading %s never publishes a partially accepted document", async (failure) => {
    const state = await setup();
    API.get.mockResolvedValueOnce(invalidDocument(failure));
    await state.load("a".repeat(32));
    expect(state.document.value).toBeNull();
    expect(state.graph.value).toEqual({ nodes: [], edges: [], target_id: "" });
    expect(state.error.value).toBeTruthy();
    expect(state.loading.value).toBe(false);
  },
);
test.each(["different document", "missing position", "missing target", "invalid revision", "null scores"])(
  "saving %s preserves the complete edited graph and previous revision", async (failure) => {
    const state = await setup();
    const edited = { ...state.graph.value, nodes: state.graph.value.nodes.map(node => ({ ...node, note: "Keep this draft" })) };
    state.replaceGraph(edited);
    const draft = structuredClone(JSON.parse(JSON.stringify(state.graph.value)));
    API.put.mockResolvedValueOnce(invalidDocument(failure));
    expect(await state.save()).toBeNull();
    expect(state.document.value.id).toBe("a".repeat(32));
    expect(state.document.value.revision).toBe(3);
    expect(state.graph.value).toEqual(draft);
    expect(state.dirty.value).toBe(true);
    expect(state.error.value).toBeTruthy();
    expect(state.saving.value).toBe(false);
  },
);
