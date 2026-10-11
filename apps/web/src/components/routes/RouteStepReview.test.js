import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileScript, compileStyle, compileTemplate, parse } from "@vue/compiler-sfc";
import RouteStepReview from "./RouteStepReview.vue";
import { initializeLocale, setLocale } from "@/i18n";

// Rendering/identity controls only; these are not model or experimental evidence.
const receipt = () => ({
  version: 1, phase: "automated_review", basis: "route_receipt",
  grade: "operation_evidence_required", independent_review: { status: "missing" },
  purchase_identity: { policy: "defined_purchase_identity_v1", status: "unknown", unresolved_materials: [] },
  operations: { policy: "template_operation_evidence_v1", status: "evidence_required", unresolved_steps: [
    { step_id: "s1", reasons: ["distinct_disconnected_reaction_centers", "unresolved_reaction_center_mapping", "future_reason", "another_future_reason"] },
    { step_id: "s10", reasons: ["reduction_with_bond_formation"] },
  ] },
});
const wrappers = [];
function setup(props = {}) {
  const wrapper = mount(RouteStepReview, { props: { stepId: "s1", deliveryReview: receipt(), ...props },
    global: { stubs: { VIcon: { props: ["icon"], template: '<span :data-icon="icon" />' } } } });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));

test("only the exact unresolved step shows concise controlled reasons and the original warning meaning", async () => {
  const value = receipt(), before = JSON.stringify(value);
  const wrapper = setup({ deliveryReview: value });
  expect(wrapper.get("section").attributes("aria-label")).toBe("反应操作待核验");
  expect(wrapper.findAll("li").map(item => item.text())).toEqual(["包含多个独立转化", "原子对应关系未确定", "过程依据不完整"]);
  expect(wrapper.text()).not.toMatch(/s1|future_reason|another_future_reason|distinct_disconnected_reaction_centers|包含还原/);
  expect(wrapper.find("button, a, input, pre, .v-card").exists()).toBe(false);
  expect(wrapper.emitted()).toEqual({});
  await wrapper.setProps({ stepId: "s10" });
  expect(wrapper.findAll("li").map(item => item.text())).toEqual(["包含还原与成键转化"]);
  await wrapper.setProps({ stepId: "s" });
  expect(wrapper.find("section").exists()).toBe(false);
  await wrapper.setProps({ stepId: "S1" });
  expect(wrapper.find("section").exists()).toBe(false);
  expect(JSON.stringify(value)).toBe(before);
});

test("fresh English and explicit Chinese share reason labels without exposing source codes", async () => {
  initializeLocale(null);
  const value = receipt(), before = JSON.stringify(value);
  const wrapper = setup({ deliveryReview: value });
  expect(wrapper.get("section").attributes("aria-label")).toBe("Reaction operations unverified");
  expect(wrapper.findAll("li").map(item => item.text())).toEqual([
    "Includes multiple independent transformations", "Atom correspondence unresolved", "Process evidence incomplete",
  ]);
  setLocale("zh-CN", { persist: false }); await wrapper.vm.$nextTick();
  expect(wrapper.findAll("li").map(item => item.text())).toEqual(["包含多个独立转化", "原子对应关系未确定", "过程依据不完整"]);
  expect(JSON.stringify(value)).toBe(before);
});

test.each(["missing", "future", "stored", "aggregate", "grade", "duplicate", "reason", "resolved"])("%s receipts cannot show step-level operation evidence", variant => {
  const value = receipt();
  if (variant === "future") value.version = 2;
  if (variant === "stored") value.basis = "stored_summary";
  if (variant === "aggregate") value.basis = "selected_routes";
  if (variant === "grade") value.grade = "model_checked";
  if (variant === "duplicate") value.operations.unresolved_steps[1].step_id = "s1";
  if (variant === "reason") value.operations.unresolved_steps[0].reasons = [""];
  if (variant === "resolved") {
    value.grade = "not_independently_reviewed";
    value.operations.status = "screened";
    value.operations.unresolved_steps = [];
  }
  const wrapper = setup({ deliveryReview: variant === "missing" ? null : value });
  expect(wrapper.find("section").exists()).toBe(false);
  expect(wrapper.text()).toBe("");
});

test("purchase form precedence does not hide valid step reasons and replacement retires them", async () => {
  const value = receipt();
  value.grade = "purchase_form_unresolved";
  value.purchase_identity.status = "unresolved";
  value.purchase_identity.unresolved_materials = [{ smiles: "CC", reason: "indeterminate_purchase_structure" }];
  const wrapper = setup({ deliveryReview: value, stepId: "s10" });
  expect(wrapper.text()).toContain("包含还原与成键转化");
  await wrapper.setProps({ deliveryReview: null });
  expect(wrapper.find("section").exists()).toBe(false);
});

test("step review compiles with the real Vue script, template and scoped style compiler", () => {
  const filename = resolve(__dirname, "RouteStepReview.vue");
  const { descriptor, errors } = parse(readFileSync(filename, "utf8"), { filename });
  expect(errors).toEqual([]);
  const id = "route-step-review", script = compileScript(descriptor, { id });
  expect(compileTemplate({ filename, id, source: descriptor.template.content,
    compilerOptions: { bindingMetadata: script.bindings } }).errors).toEqual([]);
  expect(compileStyle({ filename, id, source: descriptor.styles[0].content, scoped: true }).errors).toEqual([]);
});
