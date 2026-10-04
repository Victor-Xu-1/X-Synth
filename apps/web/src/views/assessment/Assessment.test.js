import { nextTick, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import Assessment from "./Assessment.vue";
import { calculationStubs, deferred, realCalculation } from "./test-support";

jest.mock("vue-router", () => ({ useRoute: jest.fn() }));
jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/components/SmilesImage.vue", () => ({ name: "SmilesImage", template: "<div />" }));
jest.mock("@/components/workspace/StructureInput.vue", () => ({ name: "StructureInput", template: "<div />" }));
jest.mock("@/components/ModuleWorkbench.vue", () => ({ name: "ModuleWorkbench", template: "<slot />" }));
let result;
const wrappers = [];
beforeAll(() => { result = realCalculation("assessment", { smiles: "N[C@@H](C)C(=O)O" }); });
beforeEach(() => { API.post.mockReset(); });
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); });
function setup() {
  const route = reactive({ query: { smiles: "N[C@@H](C)C(=O)O" } });
  useRoute.mockReturnValue(route);
  const wrapper = mount(Assessment, { global: { stubs: calculationStubs } });
  wrappers.push(wrapper);
  return { wrapper, route };
}

test("prefill is structure only; submit displays actual RDKit metrics and attribution", async () => {
  const { wrapper } = setup();
  expect(API.post).not.toHaveBeenCalled();
  API.post.mockResolvedValue(result);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(API.post).toHaveBeenCalledWith("/api/v1/assessment/molecule", { smiles: "N[C@@H](C)C(=O)O" });
  expect(wrapper.text()).toContain("SA Score");
  expect(wrapper.text()).toContain("Bertz CT");
  expect(wrapper.text()).toContain("BSD-3-Clause");
  expect(wrapper.text()).toContain(result.rdkit_version);
  expect(wrapper.get(".structure-identity").text()).toBe(result.structure.smiles);
  expect(wrapper.text()).toContain("不是完整路线验证");
});

test("editing immediately clears result and late replies cannot bind to a new molecule", async () => {
  const { wrapper } = setup(), late = deferred();
  API.post.mockReturnValueOnce(late.promise);
  await wrapper.get("form").trigger("submit");
  wrapper.getComponent({ name: "StructureInput" }).vm.$emit("update:modelValue", "CCO");
  await nextTick();
  late.resolve(result);
  await flushPromises();
  expect(wrapper.find(".assessment-results").exists()).toBe(false);
  API.post.mockResolvedValue(realCalculation("assessment", { smiles: "CCO" }));
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get(".structure-identity").text()).toBe("CCO");
  await wrapper.get("textarea").setValue("CCN");
  expect(wrapper.find(".assessment-results").exists()).toBe(false);
});

test("unconfirmed drawing/file selections prevent submission and hide earlier evidence", async () => {
  const { wrapper } = setup();
  API.post.mockResolvedValue(result);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  wrapper.getComponent({ name: "StructureInput" }).vm.pending = true;
  await nextTick();
  await wrapper.get("form").trigger("submit");
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(wrapper.find(".assessment-results").exists()).toBe(false);
});

test("query changes invalidate an outstanding request without auto-calculation", async () => {
  const { wrapper, route } = setup(), late = deferred();
  API.post.mockReturnValue(late.promise);
  await wrapper.get("form").trigger("submit");
  route.query = { smiles: "O" };
  await nextTick();
  late.resolve(result);
  await flushPromises();
  expect(wrapper.get("textarea").element.value).toBe("O");
  expect(wrapper.find(".assessment-results").exists()).toBe(false);
  expect(API.post).toHaveBeenCalledTimes(1);
});

test("calculation errors are visible, malformed numeric results are not displayed", async () => {
  const { wrapper } = setup();
  API.post.mockRejectedValueOnce(new Error(JSON.stringify({ detail: "SA 片段数据不可用。" })));
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe("SA 片段数据不可用。");
  API.post.mockResolvedValue({ ...result, descriptors: {} });
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.find(".assessment-results").exists()).toBe(false);
  expect(wrapper.get('[role="alert"]').exists()).toBe(true);
});

test("salt output contains every component without an invented aggregate score", async () => {
  const { wrapper } = setup();
  await wrapper.get("textarea").setValue("[Na+].CC(=O)[O-]");
  API.post.mockResolvedValue(realCalculation("assessment", { smiles: "[Na+].CC(=O)[O-]" }));
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.findAll("tbody tr")).toHaveLength(2);
  expect(wrapper.text()).toContain("不合并");
  expect(wrapper.text()).toContain("未定义");
});

test("disposed views ignore late responses", async () => {
  const { wrapper } = setup(), late = deferred();
  API.post.mockReturnValue(late.promise);
  await wrapper.get("form").trigger("submit");
  wrapper.unmount();
  late.resolve(result);
  await flushPromises();
  expect(wrapper.exists()).toBe(false);
});

test("optional shared analysis id remains technical and gets an encoded record link", async () => {
  const { wrapper } = setup();
  API.post.mockResolvedValue({ ...result, record_id: "a".repeat(32) });
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get(".analysis-record-link").attributes("href")).toBe(`/analyses/${"a".repeat(32)}`);
  expect(wrapper.get(".analysis-record-link").text()).toBe("查看本次记录");
  expect(wrapper.text()).not.toContain("a".repeat(32));
});
