import { mount, flushPromises } from "@vue/test-utils";
import DocumentPreview from "./DocumentPreview.vue";
import { setLocale } from "@/i18n";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@vue/compiler-sfc";
import postcss from "postcss";

jest.mock("./RouteGraph.vue", () => ({ name: "RouteGraph", props: ["graph", "scores"], emits: ["select"], template: '<div class="preview-graph" />' }));
jest.mock("./RouteInspector.vue", () => ({ name: "RouteInspector", props: ["graph", "node"], template: '<aside class="route-inspector" />' }));
const document = { id: "a".repeat(32), title: "原始研究路线", graph: { target_id: "m1",
  nodes: [{ id: "m1", type: "molecule", smiles: "[13CH3][C@H](O)C(=O)[O-].[Na+]", position: { x: 20, y: 20 } }], edges: [] } };
const stubs = {
  VDialog: { props: ["modelValue"], template: '<div v-if="modelValue" role="dialog"><slot /></div>' },
  VCard: { template: '<section><slot /></section>' },
  VBtn: { template: '<button><slot /></button>' },
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
