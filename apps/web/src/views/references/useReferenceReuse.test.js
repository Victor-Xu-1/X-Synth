import { defineComponent, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { deferred } from "../workspace/reaction-canvas.test-support";
import { useReferenceReuse } from "./useReferenceReuse";

const row = Object.freeze({
  id: "source-record", reactants: Object.freeze(["CCO", "CCO"]),
  products: Object.freeze(["CC=O", "Cl"]), agents: Object.freeze(["O"]),
});
const body = () => ({ products: [...row.products], agents: [...row.agents], reactants: [...row.reactants] });
const wrappers = [];
function setup() {
  const canvas = ref({ pending: false, importRecords: jest.fn(), cancelImport: jest.fn(() => { canvas.value.pending = false; }) });
  const reactionSmiles = ref("CC=O"), response = ref({ results: [row] });
  const loading = ref(false), linkedInput = ref(false), proposal = ref(false), layer = ref("records");
  const returnToRecords = jest.fn(() => { layer.value = "records"; });
  let reuse;
  wrappers.push(mount(defineComponent({
    setup() { reuse = useReferenceReuse({ canvas, reactionSmiles, response, loading, linkedInput, proposal, layer, returnToRecords }); },
    template: "<div />",
  })));
  return { reuse, canvas, reactionSmiles, response, loading, linkedInput, proposal, layer, returnToRecords };
}
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));

test("the accepted immutable source supplies every ordered role including duplicate reactants and independent products", async () => {
  const state = setup(), before = JSON.stringify(row);
  state.canvas.value.importRecords.mockImplementation(async () => { state.canvas.value.pending = true; return true; });
  await state.reuse.load(body(), row.id);
  expect(state.canvas.value.importRecords).toHaveBeenCalledWith({ reactants: ["CCO", "CCO"], products: ["CC=O", "Cl"], agents: ["O"] });
  expect(state.reuse.phase.value).toBe("preview");
  expect(state.proposal.value).toBe(true);
  expect(state.layer.value).toBe("query");
  state.canvas.value.pending = false;
  await nextTick();
  expect(state.returnToRecords).toHaveBeenCalledTimes(1);
  expect(state.reuse.record.value).toBeNull();
  expect(JSON.stringify(row)).toBe(before);
});

test.each([
  { reactants: ["CCO"], products: ["CC=O", "Cl"], agents: ["O"] },
  { reactants: ["CCO", "CCO"], products: ["CC=O"], agents: ["O"] },
  { reactants: ["CCO", "CCO"], products: ["CC=O", "Cl"], agents: [] },
])("partial or foreign role records never reach the shared canvas: %p", async records => {
  const { reuse, canvas } = setup();
  expect(await reuse.load(records)).toBe(false);
  expect(canvas.value.importRecords).not.toHaveBeenCalled();
});

test.each([false, "reject"])("a failed transfer (%s) retains the source and enables explicit retry without revising chemistry", async failure => {
  const state = setup();
  state.canvas.value.importRecords.mockImplementation(async () => {
    if (failure === "reject") throw new Error("isolated transport failure");
    return false;
  });
  expect(await state.reuse.load(body(), row.id)).toBe(false);
  expect(state.reuse.phase.value).toBe("error");
  expect(state.reuse.error.value).toBe("记录操作失败，请重试。");
  expect(state.reuse.record.value.id).toBe(row.id);
  expect(state.proposal.value).toBe(false);
  expect(state.reactionSmiles.value).toBe("CC=O");
  state.canvas.value.importRecords.mockImplementation(async () => { state.canvas.value.pending = true; return true; });
  expect(await state.reuse.load(body(), row.id)).toBe(true);
  expect(state.reuse.error.value).toBe("");
});

test.each(["resolve", "reject"])("cancel invalidates an unresolved transfer and its late %s cannot publish a draft, error or navigation", async outcome => {
  const state = setup(), held = deferred();
  state.canvas.value.importRecords.mockImplementation(() => { state.canvas.value.pending = true; return held.promise; });
  const request = state.reuse.load(body(), row.id);
  await flushPromises();
  expect(state.reuse.phase.value).toBe("preparing");
  state.reuse.cancel();
  expect(state.canvas.value.cancelImport).toHaveBeenCalledTimes(1);
  expect(state.returnToRecords).toHaveBeenCalledTimes(1);
  if (outcome === "resolve") held.resolve(true); else held.reject(new Error("late failure"));
  await request;
  expect(state.reuse.phase.value).toBe("");
  expect(state.reuse.error.value).toBe("");
  expect(state.returnToRecords).toHaveBeenCalledTimes(1);
});

test.each(["input", "response", "link", "unmount"])("a superseding %s retires a held transfer without restoring the old view", async change => {
  const state = setup(), held = deferred();
  state.canvas.value.importRecords.mockImplementation(() => { state.canvas.value.pending = true; return held.promise; });
  const request = state.reuse.load(body(), row.id);
  await flushPromises();
  if (change === "input") state.reactionSmiles.value = "CCN";
  if (change === "response") state.response.value = null;
  if (change === "link") state.linkedInput.value = true;
  if (change === "unmount") wrappers.pop().unmount();
  expect(state.canvas.value.cancelImport).toHaveBeenCalledTimes(1);
  expect(state.canvas.value.pending).toBe(false);
  held.resolve(true); await request;
  expect(state.reuse.phase.value).toBe("");
  expect(state.proposal.value).toBe(false);
  expect(state.returnToRecords).not.toHaveBeenCalled();
});

test("reset releases only an owned staged import and is idempotent", async () => {
  const state = setup(), held = deferred();
  state.canvas.value.pending = true;
  expect(state.reuse.reset()).toBe(false);
  expect(state.canvas.value.cancelImport).not.toHaveBeenCalled();
  state.canvas.value.pending = false;
  state.canvas.value.importRecords.mockImplementation(() => { state.canvas.value.pending = true; return held.promise; });
  const request = state.reuse.load(body(), row.id);
  await flushPromises();
  expect(state.reuse.reset()).toBe(true);
  expect(state.reuse.reset()).toBe(false);
  expect(state.canvas.value.cancelImport).toHaveBeenCalledTimes(1);
  held.resolve(true); await request;
  expect(state.returnToRecords).not.toHaveBeenCalled();
});

test("query replacement cancels the shared staged import itself, not just the local continuation", async () => {
  const state = setup(), held = deferred();
  state.canvas.value.importRecords.mockImplementation(() => { state.canvas.value.pending = true; return held.promise; });
  const request = state.reuse.load(body(), row.id);
  await flushPromises();
  state.response.value = null;
  expect(state.canvas.value.cancelImport).toHaveBeenCalledTimes(1);
  expect(state.canvas.value.pending).toBe(false);
  held.resolve(true); await request;
  expect(state.returnToRecords).not.toHaveBeenCalled();
});
