import { mount } from "@vue/test-utils";
import { useWorkspaceStore } from "@/store/workspace";
import ConditionRecommendation from "./ConditionRecommendation.vue";

jest.mock("@/store/workspace", () => ({ useWorkspaceStore: jest.fn() }));
jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage", props: ["smiles"], template: '<span class="condition-structure">{{ smiles }}</span>',
}));
const row = { temperature: 0, score: 0, solvent: "O", reagent: "", catalyst: "" };
const wrappers = [];
function setup(props = {}, features = ["conditions", "fast_filter"]) {
  useWorkspaceStore.mockReturnValue({ can: (feature) => features.includes(feature) });
  const wrapper = mount(ConditionRecommendation, { props, global: { stubs: {
    VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
    VIcon: true, VProgressLinear: true,
  } } });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("real result fields stay distinct, including zeros and unspecified agents", () => {
  const wrapper = setup({ results: [row], score: 0 });
  expect(wrapper.get("tbody").text()).toContain("0.0");
  expect(wrapper.get("tbody").text()).toContain("0.0000");
  expect(wrapper.findAll(".condition-structure")).toHaveLength(1);
  expect(wrapper.text()).toContain("未预测");
  expect(wrapper.text()).toContain("反应模型评分（FF）：0.000");
  expect(wrapper.findAll('th[scope="col"]')).toHaveLength(6);
  expect(wrapper.text()).not.toContain("产物预测");
});
test.each([NaN, Infinity])("nonfinite numeric fields %s are never printed as evidence", (value) => {
  const wrapper = setup({ results: [{ ...row, score: value, temperature: value }], score: value });
  expect(wrapper.text()).not.toMatch(/NaN|Infinity|反应模型评分（FF）/);
  expect(wrapper.text()).toContain("未提供");
});
test("pending hides old results and exposes a live status", () => {
  const wrapper = setup({ pending: 1, results: [row] });
  expect(wrapper.find("table").exists()).toBe(false);
  expect(wrapper.get('[role="status"]').text()).toContain("计算条件候选");
  expect(wrapper.get("section").attributes("aria-busy")).toBe("true");
});
test("empty, completed-empty, and failure states are distinct", async () => {
  const wrapper = setup();
  expect(wrapper.text()).toContain("暂无条件候选");
  await wrapper.setProps({ submitted: true });
  expect(wrapper.text()).toContain("未返回条件候选");
  await wrapper.setProps({ error: "service_unavailable" });
  expect(wrapper.text()).toContain("条件预测未完成");
  expect(wrapper.text()).not.toContain("未返回条件候选");
});
test("evaluation is gated by readiness and unconfirmed drafts", async () => {
  const unavailable = setup({ results: [row] }, ["conditions"]);
  expect(unavailable.find("button").exists()).toBe(false);
  const wrapper = setup({ results: [row] });
  await wrapper.get("button").trigger("click");
  expect(wrapper.emitted("evaluate")).toHaveLength(1);
  await wrapper.setProps({ inputPending: true });
  expect(wrapper.get("button").element.disabled).toBe(true);
  await wrapper.setProps({ inputPending: false, evaluating: true });
  expect(wrapper.get("button").element.disabled).toBe(true);
});
test("implementation and asset IDs are in collapsible details only", () => {
  const wrapper = setup({ results: [row], prediction: {
    model: "nn_v1", asset_identity: "a".repeat(64), reactants: "CCO", product: "CC=O",
  } });
  expect(wrapper.get("details").attributes("open")).toBeUndefined();
  expect(wrapper.get("details").text()).toContain("nn_v1");
  expect(wrapper.get("details").text()).toContain("a".repeat(64));
});
test("persisted empty predictions link to their real research record", () => {
  const wrapper = setup({ submitted: true, prediction: { record_id: "record/id" } });
  expect(wrapper.get('[data-cy="condition-record-link"]').attributes("to")).toBe("/analyses/record%2Fid");
  expect(wrapper.text()).toContain("未返回条件候选");
  expect(wrapper.find('[data-cy="evaluate-reaction"]').exists()).toBe(false);
});
test("typed ingredient metadata draws canonical structures and preserves label-only identities", () => {
  const wrapper = setup({ results: [{ ...row, solvent: "original solvent", reagent: "DIPEA (label)",
    ingredients: {
      solvent: { label: "original solvent", smiles: "CCO", status: "structure" },
      reagent: { label: "DIPEA (label)", smiles: null, status: "label_only" },
      catalyst: { label: "", smiles: null, status: "not_predicted" },
    },
  }] });
  expect(wrapper.findAll(".condition-structure")).toHaveLength(1);
  expect(wrapper.get(".condition-structure").text()).toBe("CCO");
  expect(wrapper.get('[data-cy="condition-ingredient-label"]').text()).toBe("DIPEA (label)");
  expect(wrapper.text()).toContain("未预测");
  expect(wrapper.get("tbody").text()).not.toContain("original solvent");
});
test("label-only text is escaped instead of rendered as markup or passed to the renderer", () => {
  const label = "<img src=x onerror=alert(1)>";
  const wrapper = setup({ results: [{ ...row, solvent: label, ingredients: {
    solvent: { label, smiles: null, status: "label_only" },
    reagent: { label: "", smiles: null, status: "not_predicted" },
    catalyst: { label: "", smiles: null, status: "not_predicted" },
  } }] });
  expect(wrapper.findAll(".condition-structure")).toHaveLength(0);
  expect(wrapper.get('[data-cy="condition-ingredient-label"]').text()).toBe(label);
  expect(wrapper.find("img").exists()).toBe(false);
});
