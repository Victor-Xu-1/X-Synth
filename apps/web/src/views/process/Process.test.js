import { nextTick, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import Process from "./Process.vue";
import { calculationStubs, deferred, realCalculation } from "../assessment/test-support";
import { freshProcessForm } from "./process-draft";
import { processBody } from "./process-form";

jest.mock("vue-router", () => ({ useRoute: jest.fn(), useRouter: jest.fn() }));
jest.mock("@/common/api", () => ({ API: { post: jest.fn(), get: jest.fn() } }));
jest.mock("@/components/workspace/StructureInput.vue", () => ({ name: "StructureInput", template: "<div />" }));
jest.mock("@/components/ModuleWorkbench.vue", () => ({ name: "ModuleWorkbench", template: "<slot />" }));
jest.mock("@/components/SmilesImage.vue", () => ({ name: "SmilesImage", template: "<div />" }));
const wrappers = [], push = jest.fn();
const recordId = "b".repeat(32);
const tabs = {
  VDialog: { props: ["modelValue"], template: '<div v-if="modelValue"><slot /></div>' },
};
beforeEach(() => {
  API.post.mockReset(); API.get.mockReset(); push.mockReset().mockResolvedValue(undefined);
  useRouter.mockReturnValue({ push });
  let id = 0; crypto.randomUUID = () => `material-${++id}`;
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
function setup(query = { smiles: "CCO" }) {
  const route = reactive({ query }); useRoute.mockReturnValue(route);
  const wrapper = mount(Process, { attachTo: document.body, global: { stubs: { ...calculationStubs, ...tabs } } });
  wrappers.push(wrapper); return { wrapper, route };
}
async function fillMasses(wrapper) {
  await wrapper.get('[aria-label="投料 1 质量"]').setValue("100");
  await wrapper.get('[aria-label="分离产物总质量"]').setValue("20");
}
function labeledInput(wrapper, text) {
  return wrapper.findAll("label").find((label) => label.text().includes(text)).get('input[type="number"]');
}
function compute() {
  API.post.mockImplementation((_, body) => Promise.resolve({ ...realCalculation("process", body), record_id: recordId }));
}

test("input has purposeful sections and no empty result pane or per-row drawing boards", () => {
  const { wrapper } = setup();
  expect(wrapper.find(".process-result").exists()).toBe(false);
  expect(wrapper.text()).not.toContain("暂无批次核算结果");
  expect(wrapper.findAll('[role="tabpanel"]')).toHaveLength(3);
  expect(wrapper.findAllComponents({ name: "StructureInput" })).toHaveLength(1);
  expect(wrapper.get('[aria-label="投料 1 质量"]').element.value).toBe("");
});

test("adjacent input navigation keeps entered quantities and focuses the selected layer", async () => {
  const { wrapper } = setup(); await fillMasses(wrapper);
  await wrapper.get('[data-section-next]').trigger("click"); await nextTick();
  expect(wrapper.get('[data-section="inputs"]').isVisible()).toBe(true);
  expect(document.activeElement).toBe(wrapper.get('[data-section="inputs"]').element);
  expect(wrapper.get('[data-section="product"]').isVisible()).toBe(false);
  expect(wrapper.get('[aria-label="分离产物总质量"]').element.value).toBe("20");
  await wrapper.get('[data-section-next]').trigger("click"); await nextTick();
  expect(wrapper.get('[data-section="outputs"]').isVisible()).toBe(true);
  expect(wrapper.find('[data-section-next]').exists()).toBe(false);
  await wrapper.get('[data-section-previous]').trigger("click"); await nextTick();
  expect(wrapper.get('[data-section="inputs"]').isVisible()).toBe(true);
  expect(wrapper.get('[aria-label="投料 1 质量"]').element.value).toBe("100");
  expect(API.post).not.toHaveBeenCalled();
});

test("unconfirmed material edits lock layer navigation instead of hiding an open chemical editor", async () => {
  const { wrapper } = setup();
  await wrapper.get('[data-section-next]').trigger("click"); await nextTick();
  await wrapper.get('[aria-label="编辑投料 1 结构"]').trigger("click");
  expect(wrapper.get('[data-section-next]').attributes("disabled")).toBeDefined();
  expect(wrapper.get('[data-section-previous]').attributes("disabled")).toBeDefined();
  await wrapper.get('[aria-label="关闭物料绘图"]').trigger("click");
  expect(wrapper.get('[data-section-next]').attributes("disabled")).toBeUndefined();
});

test("actual RDKit computation opens only the saved result page without seeded purity or yield", async () => {
  const { wrapper } = setup(); await fillMasses(wrapper); compute();
  await wrapper.get("form").trigger("submit"); await flushPromises();
  const body = API.post.mock.calls[0][1];
  expect(body.product.purity_mass_percent).toBeNull();
  expect(body.product.reported_yield_percent).toBeNull();
  expect(body.yield_basis).toBeNull(); expect(body.materials[0].smiles).toBeNull();
  expect(push).toHaveBeenCalledWith({ path: `/analyses/${recordId}`, query: { kind: "process" } });
  expect(wrapper.find(".process-metrics").exists()).toBe(false);
});

test("boundary, purity, zero reported yield and original mass units stay separate in the submitted batch", async () => {
  const { wrapper } = setup(); await fillMasses(wrapper);
  await labeledInput(wrapper, "产物质量纯度").setValue("80");
  await labeledInput(wrapper, "录入实验收率").setValue("0");
  await wrapper.get(".boundary-label input").setValue(true); compute();
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(API.post.mock.calls[0][1]).toMatchObject({ input_boundary_complete: true, product: { purity_mass_percent: 80, reported_yield_percent: 0 } });
  await wrapper.get('[aria-label="投料 1 单位"]').setValue("kg");
  expect(wrapper.find(".process-metrics").exists()).toBe(false);
});

test("adding/removing rows does not seed chemistry, mass or additional editors", async () => {
  const { wrapper } = setup(); const table = wrapper.getComponent({ name: "MaterialTable" });
  await table.findAll("button")[0].trigger("click");
  expect(wrapper.get('[aria-label="投料 2 质量"]').element.value).toBe("");
  expect(wrapper.findAllComponents({ name: "StructureInput" })).toHaveLength(1);
  await wrapper.get('[aria-label="移除投料 2"]').trigger("click");
  expect(wrapper.find('[aria-label="投料 2 质量"]').exists()).toBe(false);
});

test("an unconfirmed material editor blocks calculation and cancellation retains the original row", async () => {
  const { wrapper } = setup();
  await wrapper.get('[aria-label="编辑投料 1 结构"]').trigger("click");
  await wrapper.get("form").trigger("submit"); expect(API.post).not.toHaveBeenCalled();
  await wrapper.get('[aria-label="关闭物料绘图"]').trigger("click");
  expect(wrapper.getComponent({ name: "MaterialTable" }).props("modelValue")[0].smiles).toBe("");
});

test("edits and navigation reject late replies without opening the older result", async () => {
  const { wrapper, route } = setup(), late = deferred(); await fillMasses(wrapper);
  let body; API.post.mockImplementation((_, value) => { body = value; return late.promise; });
  await wrapper.get("form").trigger("submit");
  const table = wrapper.getComponent({ name: "MaterialTable" });
  table.vm.$emit("update:modelValue", table.props("modelValue").map((row) => ({ ...row, mass: { ...row.mass, value: "200" } })));
  await nextTick(); late.resolve({ ...realCalculation("process", body), record_id: recordId }); await flushPromises();
  expect(push).not.toHaveBeenCalled(); route.query = { smiles: "CCN" }; await nextTick();
  expect(wrapper.get('[aria-label="产物完整结构"]').element.value).toBe("CCN");
  expect(wrapper.get('[aria-label="分离产物总质量"]').element.value).toBe("");
});

test("incomplete yield basis, service errors and missing saved result identities stay explicit", async () => {
  const { wrapper } = setup(); await wrapper.get(".yield-section input[type=checkbox]").setValue(true);
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(API.post).not.toHaveBeenCalled(); expect(wrapper.get('[role="alert"]').text()).toContain("收率依据缺少");
  await wrapper.get(".yield-section input[type=checkbox]").setValue(false);
  API.post.mockRejectedValue(new Error(JSON.stringify({ detail: "出料超过投料。" })));
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe("出料超过投料。");
  await fillMasses(wrapper); API.post.mockImplementation((_, body) => Promise.resolve(realCalculation("process", body)));
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("缺少可打开的研究记录"); expect(push).not.toHaveBeenCalled();
});

test("return/edit restores the complete saved batch, not only SMILES, and never mutates the original input", async () => {
  const form = freshProcessForm(); form.product.smiles = "[Na+].CC(=O)[O-]";
  form.product.mass = { value: 20, unit: "mg" }; form.product.reported_yield_percent = 0;
  form.materials[0].mass = { value: 100, unit: "g" }; form.inputBoundaryComplete = true;
  const inputs = processBody(form), original = JSON.stringify(inputs);
  API.get.mockResolvedValue({ id: recordId, kind: "process", status: "completed", created: "2026-10-08T00:00:00Z", inputs, result: {}, error: null });
  const { wrapper } = setup({ record: recordId }); await flushPromises();
  expect(wrapper.get('[aria-label="产物完整结构"]').element.value).toBe(inputs.product.smiles);
  expect(wrapper.get('[aria-label="产物质量单位"]').element.value).toBe("mg");
  expect(wrapper.get('[aria-label="投料 1 质量"]').element.value).toBe("100");
  expect(labeledInput(wrapper, "录入实验收率").element.value).toBe("0");
  expect(wrapper.get(".boundary-label input").element.checked).toBe(true);
  expect(JSON.stringify(inputs)).toBe(original); expect(API.post).not.toHaveBeenCalled();
});
