import { nextTick, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import Assessment from "./Assessment.vue";
import { calculationStubs, deferred, realCalculation } from "./test-support";
jest.mock("vue-router", () => ({ useRoute: jest.fn(), useRouter: jest.fn() }));
jest.mock("@/common/api", () => ({ API: { post: jest.fn(), get: jest.fn() } }));
jest.mock("@/components/workspace/StructureInput.vue", () => ({ name: "StructureInput", template: "<div />" }));
jest.mock("@/components/ModuleWorkbench.vue", () => ({ name: "ModuleWorkbench", template: "<slot />" }));
const wrappers = [], push = jest.fn(), recordId = "a".repeat(32);
let result;
beforeAll(() => { result = { ...realCalculation("assessment", { smiles: "N[C@@H](C)C(=O)O" }), record_id: recordId }; });
beforeEach(() => { API.post.mockReset(); API.get.mockReset(); push.mockReset().mockResolvedValue(undefined); useRouter.mockReturnValue({ push }); });
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
function setup(query = { smiles: "N[C@@H](C)C(=O)O" }) {
  const route = reactive({ query }); useRoute.mockReturnValue(route);
  const wrapper = mount(Assessment, { global: { stubs: calculationStubs } }); wrappers.push(wrapper);
  return { wrapper, route };
}
test("input contains no empty result pane and accepted calculation opens its immutable record", async () => {
  const { wrapper } = setup(); API.post.mockResolvedValue(result);
  expect(wrapper.text()).not.toContain("暂无分子评估结果");
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(API.post).toHaveBeenCalledWith("/api/v1/assessment/molecule", { smiles: "N[C@@H](C)C(=O)O" });
  expect(push).toHaveBeenCalledWith({ path: `/analyses/${recordId}`, query: { kind: "assessment" } });
  expect(wrapper.find(".assessment-results").exists()).toBe(false);
});
test("edited molecules and navigation prevent older results from opening", async () => {
  const { wrapper, route } = setup(), late = deferred(); API.post.mockReturnValue(late.promise);
  await wrapper.get("form").trigger("submit");
  wrapper.getComponent({ name: "StructureInput" }).vm.$emit("update:modelValue", "CCO"); await nextTick();
  late.resolve(result); await flushPromises(); expect(push).not.toHaveBeenCalled();
  route.query = { smiles: "O" }; await nextTick(); expect(wrapper.get("textarea").element.value).toBe("O");
});
test("unconfirmed structure prevents requests and disposed views reject late replies", async () => {
  const { wrapper } = setup(); wrapper.getComponent({ name: "StructureInput" }).vm.pending = true;
  await nextTick(); await wrapper.get("form").trigger("submit"); expect(API.post).not.toHaveBeenCalled();
  wrapper.getComponent({ name: "StructureInput" }).vm.pending = false; await nextTick();
  const late = deferred(); API.post.mockReturnValue(late.promise); await wrapper.get("form").trigger("submit");
  wrapper.unmount(); late.resolve(result); await flushPromises(); expect(push).not.toHaveBeenCalled();
});
test("API or response errors do not open a result; failed navigation can reopen the saved record", async () => {
  const { wrapper } = setup(); API.post.mockRejectedValueOnce(new Error(JSON.stringify({ detail: "SA 片段数据不可用。" })));
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe("SA 片段数据不可用。");
  API.post.mockResolvedValue({ ...result, descriptors: {} }); await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(push).not.toHaveBeenCalled(); API.post.mockResolvedValue(result); push.mockRejectedValue(new Error("navigation_failed"));
  await wrapper.get("form").trigger("submit"); await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("结果已保存");
  expect(wrapper.get("a").attributes("href")).toBe(`/analyses/${recordId}`);
});
test("return/edit restores the exact salt structure without automatically recalculating", async () => {
  API.get.mockResolvedValue({ id: recordId, kind: "assessment", status: "completed", created: "2026-10-08T00:00:00Z", inputs: { smiles: "[Na+].CC(=O)[O-]" }, result: {}, error: null });
  const { wrapper } = setup({ record: recordId }); await flushPromises();
  expect(wrapper.get("textarea").element.value).toBe("[Na+].CC(=O)[O-]"); expect(API.post).not.toHaveBeenCalled();
});
