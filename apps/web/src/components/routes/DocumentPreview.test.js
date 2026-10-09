import { mount, flushPromises } from "@vue/test-utils";
import DocumentPreview from "./DocumentPreview.vue";
import { setLocale } from "@/i18n";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@vue/compiler-sfc";
import postcss from "postcss";
import { ref } from "vue";

jest.mock("@vueuse/core", () => ({ useWindowSize: () => ({ width: mockWidth }), useResizeObserver: jest.fn() }));
jest.mock("./RouteGraph.vue", () => ({ name: "RouteGraph", props: ["graph", "scores"], emits: ["select", "ready"], methods: { focus: (...args) => mockFocus(...args) }, template: '<div class="preview-graph" />' }));
jest.mock("./RouteInspector.vue", () => ({ name: "RouteInspector", props: ["graph", "node"], template: '<aside class="route-inspector" />' }));
jest.mock("./DocumentStepList.vue", () => ({ name: "DocumentStepList", props: ["steps", "selectedNode"], emits: ["select", "locate"], template: '<div class="document-step-list" />' }));
const mockWidth = ref(1440), mockFocus = jest.fn();
beforeEach(() => { mockWidth.value = 1440; mockFocus.mockClear(); });
const document = { id: "a".repeat(32), title: "原始研究路线", graph: { target_id: "m1",
  nodes: [{ id: "m1", type: "molecule", smiles: "[13CH3][C@H](O)C(=O)[O-].[Na+]", position: { x: 20, y: 20 } }], edges: [] } };
const stubs = {
  VDialog: { props: ["modelValue"], template: '<div v-if="modelValue" role="dialog"><slot /></div>' },
  VCard: { template: '<section><slot /></section>' },
  VBtn: { template: '<button><slot /></button>' },
  VTabs: { name: "VTabs", props: ["modelValue"], emits: ["update:modelValue"], template: '<nav role="tablist"><slot /></nav>' },
  VTab: { props: ["value"], template: '<button role="tab" :data-view="value"><slot /></button>' },
  VSelect: { props: ["modelValue", "items"], template: '<select />' },
};
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
  const { descriptor } = parse(readFileSync(resolve(__dirname, "DocumentPreview.vue"), "utf8"));
  const css = postcss.parse(descriptor.styles[0].content);
  const values = selector => Object.fromEntries(css.nodes.find(rule => rule.selector === selector)?.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]) || []);
  expect(values(".document-preview-dialog")["max-height"]).toBe("calc(100dvh - 48px)");
  expect(values(".document-preview-heading")["flex-shrink"]).toBe("0");
  expect(values(".document-preview-body")["min-height"]).toBe("0");
  expect(values(".document-preview-canvas")["min-height"]).toBe("0");
});

test("normal leave is forwarded and editor navigation releases return focus before close", async () => {
  const events = [];
  const wrapper = mount(DocumentPreview, { props: { modelValue: true, document,
    onNavigate: () => events.push("navigate"), "onUpdate:modelValue": value => events.push(value) }, global: { stubs } });
  await wrapper.get('button[prepend-icon="mdi-pencil-outline"]').trigger("click");
  expect(events).toEqual(["navigate", false]);
  await wrapper.setProps({ modelValue: false });
  wrapper.findComponent({ name: "WorkbenchDialog" }).vm.$emit("afterLeave");
  expect(wrapper.emitted("afterLeave")).toEqual([[null]]);
  wrapper.unmount();
});
