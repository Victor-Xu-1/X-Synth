import { defineComponent, h, nextTick, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { useDocumentReading } from "./useDocumentReading";
import { setLocale } from "@/i18n";

jest.mock("@vueuse/core", () => ({ useWindowSize: () => ({ width: mockWidth }) }));
const mockWidth = ref(1440);
const source = () => ({ id: "source", graph: { target_id: "p", nodes: [
  { id: "m", type: "molecule", smiles: "[13CH3][C@H](O)Cl.[Na+]", position: { x: 10, y: 10 } },
  { id: "r", type: "reaction", label: "Raw reaction", position: { x: 220, y: 10 } },
  { id: "p", type: "molecule", smiles: "[13CH3][C@H](O)O", position: { x: 400, y: 10 } },
], edges: [{ id: "in", source: "m", target: "r", input_occurrences: 2 }, { id: "out", source: "r", target: "p" }] } });
let wrapper, state, open, record, nodes;
function control(tag = "button") {
  const element = document.createElement(tag); document.body.append(element); nodes.push(element);
  jest.spyOn(element, "getClientRects").mockReturnValue([{ width: 44, height: 44 }]);
  return element;
}
beforeEach(() => {
  mockWidth.value = 1440; open = ref(true); record = ref(source()); nodes = [];
  wrapper = mount(defineComponent({ setup() {
    state = useDocumentReading(open, record); return () => h("div");
  } }));
});
afterEach(() => { wrapper?.unmount(); nodes.forEach(node => node.remove()); jest.restoreAllMocks(); });

test("opening selects one default only; resize and locale retain the chosen view and source records", async () => {
  const before = JSON.stringify(record.value);
  mockWidth.value = 390;
  expect(state.view.value).toBe("graph");
  open.value = false; open.value = true;
  expect(state.view.value).toBe("steps");
  state.changeView("graph"); await state.selectNode("r");
  mockWidth.value = 1440; setLocale("zh-CN", { persist: false }); await nextTick();
  expect(state.view.value).toBe("graph"); expect(state.selected.value).toBe("r");
  expect(state.stepChoices.value[0].title).toBe("合成步骤 1");
  expect(JSON.stringify(record.value)).toBe(before);
});

test("desktop pointer does not steal focus but keyboard graph activation enters details and returns to its actual button", async () => {
  const entry = control(), label = document.createElement("span"); entry.append(label);
  const nodeWrapper = control("div"), inspector = control("aside"); inspector.tabIndex = -1;
  state.inspectorView.value = { $el: inspector }; entry.focus();
  await state.selectNode("r", { detail: 1, target: label, currentTarget: nodeWrapper });
  expect(document.activeElement).toBe(entry);
  await state.selectNode("r", { detail: 0, target: label, currentTarget: nodeWrapper });
  expect(document.activeElement).toBe(inspector);
  await state.closeDetails(); expect(document.activeElement).toBe(entry);
});

test("mobile pointer enters details; closing returns to the visible step action", async () => {
  mockWidth.value = 390;
  const entry = control(), inspector = control("aside"); inspector.tabIndex = -1;
  state.inspectorView.value = { $el: inspector }; entry.focus();
  await state.selectNode("r", { detail: 1, target: entry, currentTarget: entry });
  expect(document.activeElement).toBe(inspector); expect(state.mobileDetails.value).toBe(true);
  await state.closeDetails(); expect(state.mobileDetails.value).toBe(false); expect(document.activeElement).toBe(entry);
});

test.each(["view", "record", "graph", "close", "unmount"])("a pending inspector opening cannot focus after %s changes", async reason => {
  const entry = control(), inspector = control("aside"); inspector.tabIndex = -1;
  state.inspectorView.value = { $el: inspector }; entry.focus();
  const pending = state.selectNode("r", { detail: 0, target: entry, currentTarget: entry });
  if (reason === "view") state.changeView("steps");
  if (reason === "record") record.value = { ...source(), id: "replacement" };
  if (reason === "graph") record.value = { ...record.value, graph: { ...record.value.graph } };
  if (reason === "close") open.value = false;
  if (reason === "unmount") { wrapper.unmount(); wrapper = null; }
  await pending;
  expect(document.activeElement).toBe(entry);
});

test.each(["hidden", "inert", "detached", "new selection"])("closing details cannot restore a %s origin", async reason => {
  const entry = control(), inspector = control("aside"); inspector.tabIndex = -1;
  state.inspectorView.value = { $el: inspector };
  await state.selectNode("r", { detail: 0, target: entry, currentTarget: entry });
  const close = state.closeDetails();
  if (reason === "hidden") entry.hidden = true;
  if (reason === "inert") entry.setAttribute("inert", "");
  if (reason === "detached") entry.remove();
  if (reason === "new selection") state.selectNode("m");
  await close;
  expect(document.activeElement).toBe(inspector);
});

test("first location waits for graph ready, remains read-only, and focuses the exact keyboard graph entry", async () => {
  const element = control("div"), button = document.createElement("button"); element.dataset.id = "r"; element.className = "vue-flow__node"; element.append(button);
  const root = control("div"); root.append(element);
  const focus = jest.fn().mockResolvedValue(); state.graphView.value = { focus, $el: root };
  const before = JSON.stringify(record.value);
  state.changeView("steps"); await state.locateStep("r", { detail: 0 });
  expect(focus).not.toHaveBeenCalled(); expect(state.detailsOpen.value).toBe(false);
  state.graphInitialized(); await flushPromises();
  expect(focus).toHaveBeenCalledWith(["r"], { padding: 0.45, maxZoom: 1, duration: 150 });
  expect(document.activeElement).toBe(button); expect(JSON.stringify(record.value)).toBe(before);
});

test("a stale graph-ready signal or location completion cannot change the current reader focus", async () => {
  const focus = jest.fn().mockResolvedValue(); state.graphView.value = { focus };
  await state.locateStep("r"); state.changeView("steps"); state.graphInitialized(); await flushPromises();
  expect(focus).not.toHaveBeenCalled();
  const root = control("div"), entry = control(), old = document.createElement("button");
  root.innerHTML = '<div class="vue-flow__node" data-id="r"></div>'; root.firstChild.append(old);
  let finish; focus.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  state.graphView.value = { focus, $el: root }; entry.focus();
  const location = state.locateStep("r", { detail: 0 }); await flushPromises();
  state.selectNode("m"); finish(); await location;
  expect(document.activeElement).toBe(entry);
});
