import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import { API } from "@/common/api";
import { downloadChemicalFile } from "@/common/chemical-files";
import { REACTION_REQUEST_TIMEOUT_MS } from "@/common/reaction-input";
import { setLocale } from "@/i18n";
import RouteNodeContext from "./RouteNodeContext.vue";

const mockCan = jest.fn(() => false);
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => ({ can: mockCan }) }));
jest.mock("@/components/workspace/StructurePreview.vue", () => ({ template: "<div />" }));
jest.mock("@/components/workspace/MoleculeFileControls.vue", () => ({ template: "<div />" }));
jest.mock("@/components/references/ReactionReferences.vue", () => ({ template: "<div />" }));
jest.mock("./MoleculeStockDialog.vue", () => ({ template: "<div />" }));
jest.mock("./RouteConditionDialog.vue", () => ({ name: "RouteConditionDialog", props: ["reaction", "origin"], template: "<div />" }));
jest.mock("./RouteSavedStepEvidence.vue", () => ({ template: "<div />" }));
jest.mock("./RouteEvidencePanel.vue", () => ({ template: "<div />" }));
jest.mock("@/common/chemical-files", () => ({
  ...jest.requireActual("@/common/chemical-files"),
  downloadChemicalFile: jest.fn(),
}));

const Button = {
  props: ["loading"],
  emits: ["click"],
  template: '<button :data-loading="Boolean(loading)" @click="$emit(\'click\', $event)"><slot /></button>',
};
function graph() {
  return {
    target_id: "product",
    nodes: [
      { id: "alkene", type: "molecule", smiles: "C=C" },
      { id: "water", type: "molecule", smiles: "O" },
      { id: "reaction", type: "reaction" },
      { id: "product", type: "molecule", smiles: "CCO" },
    ],
    edges: [
      { source: "alkene", target: "reaction" },
      { source: "water", target: "reaction" },
      { source: "reaction", target: "product" },
    ],
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const output = { format: "rxn", content: "checked reaction export", media_type: "chemical/x-mdl-rxnfile" };
let wrapper, post;
function setup(value = graph()) {
  wrapper = mount(RouteNodeContext, {
    props: { graph: value, node: value.nodes[2] },
    global: { stubs: {
      VBtn: Button, VIcon: true, RouterLink: true, StructurePreview: true, ReactionReferences: true,
      RouteSavedStepEvidence: true, RouteEvidencePanel: true,
      MoleculeStockDialog: true, MoleculeFileControls: true,
    } },
  });
  return wrapper;
}
const exportButton = () => wrapper.get(".node-actions button");
beforeEach(() => {
  setLocale("en", { persist: false });
  downloadChemicalFile.mockClear();
  post = jest.spyOn(API, "post");
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  mockCan.mockReturnValue(false);
  jest.restoreAllMocks();
});

test("node condition preview retains its exact opener and graph reaction without a model request", async () => {
  mockCan.mockImplementation(capability => capability === "conditions");
  setup();
  const origin = wrapper.findAll(".node-actions button").find(button => button.text() === "Condition prediction");
  await origin.trigger("click");
  const dialog = wrapper.getComponent({ name: "RouteConditionDialog" });
  expect(dialog.props("origin")).toBe(origin.element);
  expect(dialog.props("reaction")).toMatchObject({ precursors: ["C=C", "O"], product: "CCO" });
  expect(post).not.toHaveBeenCalled();
});

test("RXN export owns one finite, cancellable read without changing reaction roles", async () => {
  const request = deferred();
  post.mockReturnValue(request.promise);
  setup();
  await exportButton().trigger("click");
  await exportButton().trigger("click");
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith("/api/v1/structure/reaction-export", {
    reactants: ["C=C", "O"], product: "CCO",
  }, false, { signal: expect.any(AbortSignal), timeoutMs: REACTION_REQUEST_TIMEOUT_MS });
  expect(exportButton().attributes("data-loading")).toBe("true");
  request.resolve(output);
  await flushPromises();
  expect(downloadChemicalFile).toHaveBeenCalledWith(output, "reaction");
  expect(exportButton().attributes("data-loading")).toBe("false");
});

test("a timed-out export releases the action and allows an independent retry", async () => {
  post.mockRejectedValueOnce(new DOMException("Read timed out", "TimeoutError"));
  post.mockResolvedValueOnce(output);
  setup();
  await exportButton().trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe("The service request timed out. Refresh or retry.");
  expect(exportButton().attributes("data-loading")).toBe("false");
  await exportButton().trigger("click");
  await flushPromises();
  expect(post).toHaveBeenCalledTimes(2);
  expect(post.mock.calls[1][3].signal).not.toBe(post.mock.calls[0][3].signal);
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(downloadChemicalFile).toHaveBeenCalledTimes(1);
});

test.each(["resolve", "reject"])("context replacement aborts an old read and ignores its late %s", async (outcome) => {
  const old = deferred(), current = deferred();
  post.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  setup();
  await exportButton().trigger("click");
  const signal = post.mock.calls[0][3]?.signal;
  const replacement = graph();
  replacement.nodes[0].smiles = "C#C";
  replacement.nodes[3].smiles = "CC=O";
  await wrapper.setProps({ graph: replacement });
  expect(signal?.aborted).toBe(true);
  await exportButton().trigger("click");
  expect(post.mock.calls[1][1]).toEqual({ reactants: ["C#C", "O"], product: "CC=O" });
  if (outcome === "resolve") old.resolve(output);
  else old.reject(new Error("Obsolete export failed"));
  await flushPromises();
  expect(downloadChemicalFile).not.toHaveBeenCalled();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(exportButton().attributes("data-loading")).toBe("true");
  current.resolve(output);
  await flushPromises();
  expect(downloadChemicalFile).toHaveBeenCalledTimes(1);
  expect(exportButton().attributes("data-loading")).toBe("false");
});

test("changing and restoring reaction chemistry in one tick still retires the old read", async () => {
  const request = deferred(), value = reactive(graph());
  post.mockReturnValue(request.promise);
  setup(value);
  await exportButton().trigger("click");
  const signal = post.mock.calls[0][3]?.signal;
  value.nodes[0].smiles = "C#C";
  value.nodes[0].smiles = "C=C";
  expect(signal?.aborted).toBe(true);
  request.resolve(output);
  await flushPromises();
  expect(downloadChemicalFile).not.toHaveBeenCalled();
});

test("unmount aborts the owned export and never downloads its late result", async () => {
  const request = deferred();
  post.mockReturnValue(request.promise);
  setup();
  await exportButton().trigger("click");
  const signal = post.mock.calls[0][3]?.signal;
  wrapper.unmount();
  wrapper = null;
  expect(signal?.aborted).toBe(true);
  request.resolve(output);
  await flushPromises();
  expect(downloadChemicalFile).not.toHaveBeenCalled();
});
