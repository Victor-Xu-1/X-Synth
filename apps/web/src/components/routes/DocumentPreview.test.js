import { mount, flushPromises } from "@vue/test-utils";
import DocumentPreview from "./DocumentPreview.vue";
import { setLocale } from "@/i18n";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@vue/compiler-sfc";
import postcss from "postcss";
import { ref, toRaw } from "vue";

jest.mock("@vueuse/core", () => ({ useWindowSize: () => ({ width: mockWidth }), useResizeObserver: jest.fn() }));
jest.mock("./RouteGraph.vue", () => ({ name: "RouteGraph", props: ["graph", "scores", "stepNumbers"], emits: ["select", "ready"], methods: { focus: (...args) => mockFocus(...args) }, template: '<div class="preview-graph" />' }));
jest.mock("./RouteInspector.vue", () => ({ name: "RouteInspector", props: ["graph", "node", "displayStepNumber"], template: '<aside class="route-inspector" />' }));
jest.mock("./DocumentStepList.vue", () => ({ name: "DocumentStepList", props: ["steps", "selectedNode"], emits: ["select", "locate"], template: '<div class="document-step-list" />' }));
const mockWidth = ref(1440), mockFocus = jest.fn();
beforeEach(() => { mockWidth.value = 1440; mockFocus.mockClear(); });
const document = { id: "a".repeat(32), title: "原始研究路线", graph: { target_id: "m1",
  nodes: [{ id: "m1", type: "molecule", smiles: "[13CH3][C@H](O)C(=O)[O-].[Na+]", position: { x: 20, y: 20 } }], edges: [] } };
const stubs = {
  VDefaultsProvider: { template: "<slot />" },
  VDialog: { name: "VDialog", props: ["modelValue"], emits: ["update:modelValue", "afterLeave"], template: '<div v-if="modelValue" role="dialog"><slot /></div>' },
  VCard: { template: '<section><slot /></section>' },
  VBtn: { template: '<button><slot /></button>' },
  VTabs: { name: "VTabs", props: ["modelValue"], emits: ["update:modelValue"], template: '<nav role="tablist"><slot /></nav>' },
  VTab: { props: ["value"], template: '<button role="tab" :data-view="value"><slot /></button>' },
  VSelect: { props: ["modelValue", "items"], template: '<select />' },
};

function previewStyles() {
  const { descriptor } = parse(readFileSync(resolve(__dirname, "DocumentPreview.vue"), "utf8"));
  return postcss.parse(descriptor.styles[0].content);
}
function ruleValues(container, selector) {
  return Object.fromEntries(container.nodes.find(rule => rule.selector === selector)?.nodes
    .filter(node => node.type === "decl").map(node => [node.prop, node.value]) || []);
}

test("document preview has a named heading and switching language leaves the actual route untouched", async () => {
  const wrapper = mount(DocumentPreview, { props: { modelValue: true, document }, global: { stubs } });
  const dialog = wrapper.get('[role="dialog"]');
  expect(dialog.attributes("aria-labelledby")).toBe(wrapper.get("h2").attributes("id"));
  expect(wrapper.get("h2").text()).toBe(document.title);
  const displayed = wrapper.getComponent({ name: "RouteGraph" }).props("graph");
  setLocale("en", { persist: false }); await flushPromises();
  expect(wrapper.get("h2").text()).toBe(document.title);
  expect(wrapper.text()).toContain("Open editor");
  expect(wrapper.getComponent({ name: "RouteGraph" }).props("graph")).toBe(displayed);
  wrapper.getComponent({ name: "RouteGraph" }).vm.$emit("select", "m1");
  await flushPromises();
  expect(wrapper.getComponent({ name: "RouteInspector" }).props("node").smiles).toBe(document.graph.nodes[0].smiles);
  await wrapper.get('[aria-label="Close preview"]').trigger("click");
  expect(wrapper.emitted("update:modelValue")).toEqual([[false]]);
  wrapper.unmount();
});

const connected = { ...document, graph: { target_id: "m1", nodes: [
  { id: "source", type: "molecule", smiles: "[13CH3][C@H](O)Cl", position: { x: 10, y: 10 } },
  { id: "r", type: "reaction", label: "raw label", note: "raw note", position: { x: 220, y: 10 } },
  document.graph.nodes[0],
], edges: [{ id: "in", source: "source", target: "r", input_occurrences: 2 }, { id: "out", source: "r", target: "m1" }] } };

test("mobile header keeps the full raw title and draft data while translating its single editor action", async () => {
  mockWidth.value = 390;
  const record = { ...connected, state: "draft", title: "原始研究路线 [13CH3][C@H](O)Cl / ".repeat(24) };
  const before = JSON.stringify(record);
  const wrapper = mount(DocumentPreview, { props: { modelValue: true, document: record }, global: { stubs } });
  const title = wrapper.get("h2");
  const actions = wrapper.get(".page-actions");
  expect(title.text()).toBe(record.title.trim());
  expect(title.element.textContent).toBe(record.title);
  expect(title.attributes("tabindex")).toBe("0");
  expect(wrapper.get(".state-badge").text()).toBe("草稿");
  expect(actions.element.parentElement).toBe(wrapper.get(".document-preview-heading").element);
  expect(actions.findAll("button")).toHaveLength(2);
  expect(wrapper.findAll('button[to]')).toHaveLength(1);
  const editor = actions.get(".document-preview-edit");
  expect(editor.attributes("to")).toBe(`/editor/${record.id}`);
  expect(editor.attributes("prepend-icon")).toBe("mdi-pencil-outline");
  expect(editor.attributes("aria-label")).toBe("打开编辑");
  expect(editor.attributes("title")).toBe("打开编辑");
  expect(editor.text()).toBe("打开编辑");
  setLocale("en", { persist: false }); await flushPromises();
  expect(title.element.textContent).toBe(record.title);
  expect(wrapper.get(".state-badge").text()).toBe("Draft");
  expect(editor.attributes("aria-label")).toBe("Open editor");
  expect(editor.attributes("title")).toBe("Open editor");
  expect(editor.text()).toBe("Open editor");
  expect(actions.get('[aria-label="Close preview"]').attributes("title")).toBe("Close preview");
  expect(wrapper.getComponent({ name: "DocumentStepList" }).props("steps")[0].inputs[0].count).toBe(2);
  wrapper.getComponent({ name: "VTabs" }).vm.$emit("update:modelValue", "graph"); await flushPromises();
  expect(toRaw(wrapper.getComponent({ name: "RouteGraph" }).props("graph"))).toBe(record.graph);
  expect(JSON.stringify(record)).toBe(before);
  wrapper.unmount();
});

test("Graph, Steps and inspector receive one original-ID display sequence without changing source labels", async () => {
  const before = JSON.stringify(connected);
  const wrapper = mount(DocumentPreview, { props: { modelValue: true, document: connected }, global: { stubs } });
  const graph = wrapper.getComponent({ name: "RouteGraph" });
  expect(graph.props("stepNumbers")).toEqual({ r: 1 });
  expect(graph.props("graph").nodes.find(node => node.id === "r").label).toBe("raw label");
  graph.vm.$emit("select", "r"); await flushPromises();
  expect(wrapper.getComponent({ name: "RouteInspector" }).props("displayStepNumber")).toBe(1);
  expect(JSON.stringify(connected)).toBe(before);
  wrapper.unmount();
});

test("mobile opens real saved steps and resize/language changes preserve the explicit reading view", async () => {
  mockWidth.value = 390;
  const before = JSON.stringify(connected);
  const wrapper = mount(DocumentPreview, { props: { modelValue: true, document: connected }, global: { stubs } });
  expect(wrapper.get('button[data-view="steps"]').attributes("aria-selected")).toBe("true");
  expect(wrapper.getComponent({ name: "DocumentStepList" }).props("steps")[0].inputs[0].count).toBe(2);
  mockWidth.value = 1440; setLocale("en", { persist: false }); await flushPromises();
  expect(wrapper.get('button[data-view="steps"]').attributes("aria-selected")).toBe("true");
  expect(JSON.stringify(connected)).toBe(before);
  wrapper.unmount();
});

test("first graph location waits for real graph initialization instead of being overwritten by initial fit", async () => {
  mockWidth.value = 390;
  const wrapper = mount(DocumentPreview, { props: { modelValue: true, document: connected }, global: { stubs } });
  wrapper.getComponent({ name: "DocumentStepList" }).vm.$emit("locate", "r"); await flushPromises();
  expect(mockFocus).not.toHaveBeenCalled();
  const graph = wrapper.getComponent({ name: "RouteGraph" }); graph.vm.$emit("ready"); await flushPromises();
  expect(mockFocus).toHaveBeenCalledWith(["r"], expect.objectContaining({ maxZoom: 1 }));
  expect(wrapper.get('button[data-view="graph"]').attributes("aria-selected")).toBe("true");
  expect(wrapper.findComponent({ name: "RouteInspector" }).exists()).toBe(false);
  wrapper.unmount();
});

test("Graph and Steps changes retain the current saved-document scroll container", async () => {
  mockWidth.value = 390;
  const wrapper = mount(DocumentPreview, { props: { modelValue: true, document: connected }, global: { stubs } });
  const scroll = wrapper.get(".document-step-scroll").element;
  scroll.scrollTop = 760;
  const tabs = wrapper.getComponent({ name: "VTabs" });
  tabs.vm.$emit("update:modelValue", "graph"); await flushPromises();
  expect(wrapper.get(".document-step-scroll").element).toBe(scroll);
  tabs.vm.$emit("update:modelValue", "steps"); await flushPromises();
  expect(wrapper.get(".document-step-scroll").element.scrollTop).toBe(760);
  wrapper.unmount();
});
test("a short viewport constrains the canvas under a fixed-height header without a 340px floor", () => {
  const css = previewStyles();
  const values = selector => ruleValues(css, selector);
  expect(values(".document-preview-dialog")["max-height"]).toBe("calc(100dvh - 48px)");
  expect(values(".document-preview-heading")["flex-shrink"]).toBe("0");
  expect(values(".document-preview-body")["min-height"]).toBe("0");
  expect(values(".document-preview-canvas")["min-height"]).toBe("0");
});

test("mobile CSS keeps two 44px actions beside a shrinking title with bounded full-title scrolling", () => {
  const css = previewStyles();
  expect(ruleValues(css, ".document-preview-heading .document-preview-action")).toMatchObject({ "min-height": "44px", height: "44px" });
  expect(ruleValues(css, ".document-preview-heading .document-preview-action.v-btn--icon")).toMatchObject({ width: "44px", "min-width": "44px" });
  const mobile = css.nodes.find(node => node.type === "atrule" && node.name === "media" && node.params === "(max-width: 700px)");
  expect(mobile).toBeDefined();
  expect(ruleValues(mobile, ".document-preview-heading")).toMatchObject({ "flex-wrap": "nowrap", "align-items": "flex-start" });
  expect(ruleValues(mobile, ".document-preview-title")).toMatchObject({ "min-width": "0", flex: "1 1 0%" });
  expect(ruleValues(mobile, ".document-preview-heading .page-actions")).toMatchObject({ width: "auto", "justify-content": "flex-end" });
  expect(ruleValues(mobile, ".document-preview-heading .document-preview-action")).toMatchObject({
    width: "44px", "min-width": "44px", height: "44px", padding: "0", flex: "0 0 44px",
  });
  expect(ruleValues(mobile, ".document-preview-edit")).toMatchObject({ "grid-template-areas": '"prepend"', "grid-template-columns": "1fr" });
  expect(ruleValues(mobile, ".document-preview-edit :deep(.v-btn__prepend)")).toMatchObject({ "margin-inline": "0", "justify-self": "center" });
  expect(ruleValues(mobile, ".document-preview-edit :deep(.v-btn__content)").display).toBe("none");
  expect(ruleValues(css, ".document-preview-edit :deep(.v-btn__content)").display).toBeUndefined();
  const title = ruleValues(css, ".document-preview-heading h2");
  expect(title).toMatchObject({ "min-width": "0", "max-height": "25dvh", overflow: "auto", "overflow-wrap": "anywhere" });
  expect(title["line-clamp"]).toBeUndefined();
  expect(title["-webkit-line-clamp"]).toBeUndefined();
  expect(title["text-overflow"]).toBeUndefined();
  expect(ruleValues(mobile, ".document-preview-heading h2")["flex-basis"]).toBeUndefined();
});

test.each([390, 1440])("at %ipx the single editor action releases return focus before closing and retains its presentation ticket", async width => {
  mockWidth.value = width;
  const events = [];
  const wrapper = mount(DocumentPreview, { props: { modelValue: true, document, focusTicket: 41,
    onNavigate: () => events.push("navigate"), "onUpdate:modelValue": value => events.push(value) }, global: { stubs } });
  expect(wrapper.findAll('button[to]')).toHaveLength(1);
  await wrapper.get('.document-preview-edit').trigger("click");
  expect(events).toEqual(["navigate", false]);
  expect(wrapper.emitted("navigate")).toEqual([[]]);
  expect(wrapper.emitted("update:modelValue")).toEqual([[false]]);
  expect(wrapper.emitted("afterLeave")).toBeUndefined();
  await wrapper.setProps({ modelValue: false, focusTicket: 42 });
  wrapper.getComponent({ name: "VDialog" }).vm.$emit("afterLeave");
  expect(wrapper.emitted("afterLeave")).toEqual([[41]]);
  wrapper.unmount();
});

test.each(["close", "model"])("%s dismissal preserves the model and actual-leave gate with its original focus ticket", async action => {
  mockWidth.value = 390;
  const wrapper = mount(DocumentPreview, { props: { modelValue: true, document, focusTicket: 51 }, global: { stubs } });
  const dialog = wrapper.getComponent({ name: "VDialog" });
  dialog.vm.$emit("afterLeave");
  expect(wrapper.emitted("afterLeave")).toBeUndefined();
  if (action === "close") await wrapper.get('[aria-label="关闭预览"]').trigger("click");
  else dialog.vm.$emit("update:modelValue", false);
  await flushPromises();
  expect(wrapper.emitted("update:modelValue")).toEqual([[false]]);
  expect(wrapper.emitted("navigate")).toBeUndefined();
  await wrapper.setProps({ modelValue: false, focusTicket: 52 });
  dialog.vm.$emit("afterLeave");
  expect(wrapper.emitted("afterLeave")).toEqual([[51]]);
  wrapper.unmount();
});

test("a default focus ticket remains null and disposed previews do not forward stale leave events", async () => {
  const tickets = [];
  const wrapper = mount(DocumentPreview, { props: { modelValue: true, document,
    onAfterLeave: ticket => tickets.push(ticket) }, global: { stubs } });
  await wrapper.setProps({ modelValue: false });
  wrapper.getComponent({ name: "VDialog" }).vm.$emit("afterLeave");
  expect(tickets).toEqual([null]);
  const workbench = wrapper.getComponent({ name: "WorkbenchDialog" });
  wrapper.unmount();
  workbench.vm.$emit("afterLeave");
  expect(tickets).toEqual([null]);
});
