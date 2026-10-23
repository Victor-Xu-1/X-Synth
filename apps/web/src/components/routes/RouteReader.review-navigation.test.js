import { mount, flushPromises } from "@vue/test-utils";
import { randomUUID } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import RouteReader from "./RouteReader.vue";
import { setLocale } from "@/i18n";

// Component lifecycle controls; real retained routes/API are verified separately.
Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID });
globalThis.structuredClone = value => deserialize(serialize(value));
jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => ({ can: () => false }) }));
jest.mock("@vueuse/core", () => ({ useResizeObserver: jest.fn() }));
jest.mock("@/components/SmilesImage.vue", () => ({ name: "SmilesImage", template: "<span />" }));
jest.mock("./RouteGraph.vue", () => ({ name: "RouteGraph", template: "<div />", methods: { fit() {} } }));
jest.mock("./RouteInspector.vue", () => ({ name: "RouteInspector",
  props: ["node", "step", "displayStepNumber", "deliveryReview", "automatedReview"], emits: ["close"],
  mounted() { mockInspectorMount.run?.(this.$el); },
  template: '<aside tabindex="-1"><button class="close-inspector" @click="$emit(\'close\')">Close</button></aside>',
}));
const summary = { name: "RouteReviewSummary", props: ["candidate", "busy", "inspectionEnabled"],
  emits: ["inspect-review"], template: `<section>
  <button data-reader-action="review-operations" :disabled="busy || !inspectionEnabled?.operations"
    @click="$emit('inspect-review','operations',$event)">Inspect operations</button>
  <button data-reader-action="review-purchase" :disabled="busy || !inspectionEnabled?.purchase"
    @click="$emit('inspect-review','purchase',$event)">Inspect purchase form</button></section>`,
};
const mockInspectorMount = { run: null };
const route = () => ({ route_id: "review-bindings", engine: "askcos_mcts", target_smiles: "CC=O",
  starting_materials: ["CC", "O=C([O-])[O-]"], steps: [
    { step_id: "later", product: "CC=O", precursors: ["CCO"] },
    { step_id: "earlier", product: "CCO", precursors: ["CC", "O=C([O-])[O-]"] },
  ], metadata: { delivery_review: { version: 1, phase: "automated_review", basis: "route_receipt",
    grade: "purchase_form_unresolved", independent_review: { status: "missing" },
    purchase_identity: { policy: "defined_purchase_identity_v1", status: "unresolved",
      unresolved_materials: [{ smiles: "O=C([O-])[O-]", reason: "undefined_purchase_form" }] },
    operations: { policy: "template_operation_evidence_v1", status: "evidence_required",
      unresolved_steps: [{ step_id: "earlier", reasons: ["reduction_with_bond_formation"] }] },
  } },
});
const wrappers = [];
async function setup(value, props = {}) {
  const wrapper = mount(RouteReader, { props: { candidates: [value], ...props }, attachTo: document.body,
    global: { stubs: {
      RouteReviewSummary: summary, RouteFilters: true, RouteStepList: true, RouteMaterials: true,
      RouteConditions: true, RouteEvidencePanel: true, VIcon: true, VBtn: { template: '<button><slot /></button>' },
      VCheckboxBtn: true, VMenu: true, VTooltip: true, VProgressCircular: true, VList: true, VListItem: true,
    } },
  });
  wrappers.push(wrapper); await flushPromises(); return wrapper;
}
beforeEach(() => { mockInspectorMount.run = null; setLocale("en", { persist: false }); });
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));

test("a review counter opens the exact synthetic step and carries its receipt without rewriting chemistry", async () => {
  const value = route(), before = JSON.stringify(value), wrapper = await setup(value);
  await wrapper.get('[data-reader-action="review-operations"]').trigger("click");
  await flushPromises();
  expect(wrapper.emitted("update:view").at(-1)).toEqual(["steps"]);
  const inspector = wrapper.getComponent({ name: "RouteInspector" });
  expect(inspector.props("node").id).toBe("r-2");
  expect(inspector.props("step").step_id).toBe("earlier");
  expect(inspector.props("displayStepNumber")).toBe(1);
  expect(inspector.props("deliveryReview")).toEqual(value.metadata.delivery_review);
  expect(JSON.stringify(value)).toBe(before);
});

test("purchase inspection targets the unresolved starting material,not the other raw materials", async () => {
  const wrapper = await setup(route());
  await wrapper.get('[data-reader-action="review-purchase"]').trigger("click");
  await flushPromises();
  expect(wrapper.emitted("update:view").at(-1)).toEqual(["materials"]);
  expect(wrapper.getComponent({ name: "RouteInspector" }).props("node").smiles).toBe("O=C([O-])[O-]");
});

test("step inspection receives the current saved review without rewriting source chemistry", async () => {
  const value = route();
  value.metadata.automated_review = { version: 4, forward: { records: [
    { step_id: "later", record_id: "later-record", expected_rank: 2 },
    { step_id: "earlier", record_id: "earlier-record", expected_rank: 1 },
  ] }, references: { records: [{ step_id: "earlier", refs: [] }] } };
  const before = JSON.stringify(value), wrapper = await setup(value);
  await wrapper.get('[data-reader-action="review-operations"]').trigger("click");
  await flushPromises();
  const inspector = wrapper.getComponent({ name: "RouteInspector" });
  expect(inspector.props("step").step_id).toBe("earlier");
  expect(inspector.props("automatedReview")).toEqual(value.metadata.automated_review);
  expect(JSON.stringify(value)).toBe(before);
});

test.each([true, false])("replacement saved-review presence %s cannot retain a previous route's record", async present => {
  const value = route();
  value.metadata.automated_review = { version: 4, forward: { records: [{ step_id: "earlier", record_id: "old-record" }] } };
  const wrapper = await setup(value);
  await wrapper.get('[data-reader-action="review-operations"]').trigger("click");
  await flushPromises();
  expect(wrapper.getComponent({ name: "RouteInspector" }).props("automatedReview")).toEqual(value.metadata.automated_review);
  const replacement = route();
  replacement.route_id = "replacement";
  if (present) replacement.metadata.automated_review = { version: 4, forward: {
    records: [{ step_id: "earlier", record_id: "new-record" }],
  } };
  await wrapper.setProps({ candidates: [replacement] });
  await flushPromises();
  await wrapper.get('[data-reader-action="review-operations"]').trigger("click");
  await flushPromises();
  expect(wrapper.getComponent({ name: "RouteInspector" }).props("automatedReview")).toEqual(replacement.metadata.automated_review);
});

test("closing inspection returns keyboard focus to the current detail counter", async () => {
  const wrapper = await setup(route());
  const origin = wrapper.get('[data-reader-action="review-operations"]');
  origin.element.focus(); origin.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
  await flushPromises();
  expect(document.activeElement).toBe(wrapper.getComponent({ name: "RouteInspector" }).element);
  await wrapper.get('.close-inspector').trigger("click"); await flushPromises();
  expect(document.activeElement).toBe(wrapper.get('.reader-review-summary [data-reader-action="review-operations"]').element);
});

test("busy,orphan and replaced source generations cannot install an old issue selection", async () => {
  const value = route(), wrapper = await setup(value, { busy: true });
  wrapper.getComponent({ name: "RouteReviewSummary" }).vm.$emit("inspect-review", "operations", new MouseEvent("click"));
  await flushPromises(); expect(wrapper.findComponent({ name: "RouteInspector" }).exists()).toBe(false);
  await wrapper.setProps({ busy: false });
  const replacement = route(); replacement.metadata.delivery_review.operations = {
    policy: "template_operation_evidence_v1", status: "screened", unresolved_steps: [],
  };
  wrapper.getComponent({ name: "RouteReviewSummary" }).vm.$emit("inspect-review", "operations", new MouseEvent("click"));
  await wrapper.setProps({ candidates: [replacement] }); await flushPromises();
  expect(wrapper.findComponent({ name: "RouteInspector" }).exists()).toBe(false);
  expect(wrapper.getComponent({ name: "RouteReviewSummary" }).props("inspectionEnabled").operations).toBe(false);
});

test.each(["receipt", "hidden", "inert"])("a second-stage %s change cannot commit stale review scrolling or focus", async change => {
  const value = route(), wrapper = await setup(value);
  const focus = jest.spyOn(HTMLElement.prototype, "focus");
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  const scroll = jest.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
  mockInspectorMount.run = element => {
    if (change === "receipt") value.metadata.delivery_review = { ...value.metadata.delivery_review };
    else element.closest('.route-reader').setAttribute(change, "");
  };
  try {
    await wrapper.get('[data-reader-action="review-operations"]').trigger("click");
    await flushPromises();
    expect(scroll.mock.instances.filter(element => element?.tagName === "ASIDE")).toHaveLength(0);
    expect(focus.mock.instances.filter(element => element?.tagName === "ASIDE")).toHaveLength(0);
    expect(wrapper.findComponent({ name: "RouteInspector" }).exists()).toBe(false);
  } finally {
    focus.mockRestore();
    if (original) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", original);
    else delete HTMLElement.prototype.scrollIntoView;
  }
});

test("invalidating an old inspection cannot erase a newer manual step selection", async () => {
  const value = route(), wrapper = await setup(value);
  mockInspectorMount.run = () => {
    value.metadata.delivery_review = { ...value.metadata.delivery_review };
    wrapper.getComponent({ name: "RouteStepList" }).vm.$emit("select", "r-1");
  };
  await wrapper.get('[data-reader-action="review-operations"]').trigger("click");
  await flushPromises();
  expect(wrapper.getComponent({ name: "RouteInspector" }).props("node").id).toBe("r-1");
  expect(wrapper.getComponent({ name: "RouteInspector" }).props("step").step_id).toBe("later");
});
