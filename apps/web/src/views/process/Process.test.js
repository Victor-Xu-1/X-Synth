import { nextTick, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import Process from "./Process.vue";
import { calculationStubs, deferred, realCalculation } from "../assessment/test-support";

jest.mock("vue-router", () => ({ useRoute: jest.fn() }));
jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/components/SmilesImage.vue", () => ({ name: "SmilesImage", template: "<div />" }));
jest.mock("@/components/workspace/StructureInput.vue", () => ({ name: "StructureInput", template: "<div />" }));
jest.mock("@/components/ModuleWorkbench.vue", () => ({ name: "ModuleWorkbench", template: "<slot />" }));
const wrappers = [];
beforeEach(() => {
  API.post.mockReset();
  let id = 0;
  crypto.randomUUID = () => `material-${++id}`;
});
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); });
function setup() {
  const route = reactive({ query: { smiles: "CCO" } });
  useRoute.mockReturnValue(route);
  const wrapper = mount(Process, { global: { stubs: calculationStubs } });
  wrappers.push(wrapper);
  return { wrapper, route };
}
async function fillMasses(wrapper) {
  await wrapper.get('[aria-label="投料 1 质量"]').setValue("100");
  await wrapper.get('[aria-label="分离产物总质量"]').setValue("20");
}
function labeledInput(wrapper, text) {
  return wrapper.findAll("label").find((label) => label.text().includes(text)).get('input[type="number"]');
}

test("no invented batch data; actual calculation returns partial PMI and missing purity", async () => {
  const { wrapper } = setup();
  expect(API.post).not.toHaveBeenCalled();
  expect(wrapper.get('[aria-label="投料 1 质量"]').element.value).toBe("");
  expect(labeledInput(wrapper, "产物质量纯度").element.value).toBe("");
  await fillMasses(wrapper);
  API.post.mockImplementation((_, body) => Promise.resolve(realCalculation("process", body)));
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  const body = API.post.mock.calls[0][1];
  expect(body.product.purity_mass_percent).toBeNull();
  expect(body.product.reported_yield_percent).toBeNull();
  expect(body.yield_basis).toBeNull();
  expect(body.materials[0].smiles).toBeNull();
  expect(wrapper.text()).toContain("PMI 下限");
  expect(wrapper.text()).toContain("仅报告已录入范围");
  expect(wrapper.text()).toContain("缺少质量纯度");
});

test("explicit complete boundary produces bulk PMI while purity and reported yield stay separate", async () => {
  const { wrapper } = setup();
  await fillMasses(wrapper);
  await labeledInput(wrapper, "产物质量纯度").setValue("80");
  await labeledInput(wrapper, "录入实验收率").setValue("0");
  await wrapper.get(".boundary-label input").setValue(true);
  API.post.mockImplementation((_, body) => Promise.resolve(realCalculation("process", body)));
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.text()).not.toContain("仅报告已录入范围");
  const values = wrapper.findAll(".process-metrics dd").map((row) => row.text());
  expect(values).toContain("5");
  expect(values).toContain("6.25");
  expect(values).toContain("16");
  expect(values).toContain("0");
  await wrapper.get('[aria-label="投料 1 单位"]').setValue("kg");
  expect(wrapper.find(".process-metrics").exists()).toBe(false);
});

test("adding/removing actual rows does not seed chemistry or mass", async () => {
  const { wrapper } = setup();
  const table = wrapper.getComponent({ name: "MaterialTable" });
  await table.findAll("button")[0].trigger("click");
  expect(wrapper.findAll('textarea[aria-label^="投料"]')).toHaveLength(2);
  expect(wrapper.get('[aria-label="投料 2 质量"]').element.value).toBe("");
  await wrapper.get('[aria-label="移除投料 2"]').trigger("click");
  expect(wrapper.findAll('textarea[aria-label^="投料"]')).toHaveLength(1);
});

test("unconfirmed material identity blocks accounting", async () => {
  const { wrapper } = setup();
  wrapper.findAllComponents({ name: "StructureInput" })[1].vm.pending = true;
  await nextTick();
  await wrapper.get("form").trigger("submit");
  expect(API.post).not.toHaveBeenCalled();
});

test("mass edits and navigation reject late results for an older batch", async () => {
  const { wrapper, route } = setup(), late = deferred();
  await fillMasses(wrapper);
  let body;
  API.post.mockImplementation((_, value) => { body = value; return late.promise; });
  await wrapper.get("form").trigger("submit");
  const table = wrapper.getComponent({ name: "MaterialTable" });
  table.vm.$emit("update:modelValue", table.props("modelValue").map((row) => ({ ...row, mass: { ...row.mass, value: "200" } })));
  await nextTick();
  late.resolve(realCalculation("process", body));
  await flushPromises();
  expect(wrapper.find(".process-metrics").exists()).toBe(false);
  route.query = { smiles: "CCN" };
  await nextTick();
  expect(wrapper.get('[aria-label="产物完整结构"]').element.value).toBe("CCN");
  expect(wrapper.get('[aria-label="分离产物总质量"]').element.value).toBe("");
  expect(API.post).toHaveBeenCalledTimes(1);
});

test("incomplete yield basis is explicit and produces no request", async () => {
  const { wrapper } = setup();
  await wrapper.get(".yield-section input[type=checkbox]").setValue(true);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(API.post).not.toHaveBeenCalled();
  expect(wrapper.get('[role="alert"]').text()).toContain("收率依据缺少");
});

test("server errors and malformed response cannot look like calculation success", async () => {
  const { wrapper } = setup();
  API.post.mockRejectedValue(new Error(JSON.stringify({ detail: "出料超过投料。" })));
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe("出料超过投料。");
  API.post.mockResolvedValue({ scope: "user_entered_batch_accounting" });
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.find(".process-metrics").exists()).toBe(false);
});

test("optional shared analysis record does not change calculation response acceptance", async () => {
  const { wrapper } = setup();
  await fillMasses(wrapper);
  API.post.mockImplementation((_, body) => Promise.resolve({ ...realCalculation("process", body), record_id: "b".repeat(32) }));
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get(".analysis-record-link").attributes("href")).toBe(`/analyses/${"b".repeat(32)}`);
  expect(wrapper.text()).not.toContain("b".repeat(32));
});
