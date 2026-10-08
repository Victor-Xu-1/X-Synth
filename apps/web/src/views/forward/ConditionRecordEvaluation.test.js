import { flushPromises, mount } from "@vue/test-utils";
import { API } from "@/common/api";
import { useWorkspaceStore } from "@/store/workspace";
import ConditionRecordEvaluation from "./ConditionRecordEvaluation.vue";
jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: jest.fn() }));
const result = Object.freeze({ reactants: "CCO", product: "CC=O", conditions: Object.freeze([{}]) });
const wrappers = [];
function setup(value = result, available = true) {
  useWorkspaceStore.mockReturnValue({ can: () => available });
  const wrapper = mount(ConditionRecordEvaluation, { props: { result: value }, global: { stubs: {
    VBtn: { props: ["disabled", "loading"], template: '<button :disabled="disabled || loading"><slot /></button>' },
  } } });
  wrappers.push(wrapper);
  return wrapper;
}
beforeEach(() => jest.clearAllMocks());
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("record browsing never executes FF; an explicit click preserves a zero score", async () => {
  API.post.mockResolvedValue({ result: { score: 0 } });
  const wrapper = setup();
  expect(API.post).not.toHaveBeenCalled();
  await wrapper.get("button").trigger("click"); await flushPromises();
  expect(API.post).toHaveBeenCalledWith("/api/fast-filter/call-sync", { smiles: ["CCO", "CC=O"] });
  expect(wrapper.text()).toContain("模型可行性评分（FF）：0.000");
  expect(result).toEqual({ reactants: "CCO", product: "CC=O", conditions: [{}] });
});

test.each([{ ...result, conditions: [] }, { ...result, product: "" }, { ...result, reactants: null }])("incomplete legacy or empty record cannot run: %p", async (value) => {
  const wrapper = setup(value);
  expect(wrapper.get("button").element.disabled).toBe(true);
  await wrapper.get("button").trigger("click"); expect(API.post).not.toHaveBeenCalled();
});

test("an unavailable model cannot run", () => {
  expect(setup(result, false).get("button").element.disabled).toBe(true);
});

test.each([null, -0.1, 1.1, NaN, "0.5"])('invalid FF score %p is a visible error and can be retried', async (score) => {
  API.post.mockResolvedValueOnce({ result: { score } }).mockResolvedValueOnce({ result: { score: 0.5 } });
  const wrapper = setup(); await wrapper.get("button").trigger("click"); await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("未完成");
  await wrapper.get("button").trigger("click"); await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.text()).toContain("0.500");
});

test("inflight duplicate clicks and late results after selecting another record are ignored", async () => {
  let resolve;
  API.post.mockReturnValue(new Promise((finish) => { resolve = finish; }));
  const wrapper = setup(); await wrapper.get("button").trigger("click");
  await wrapper.get("button").trigger("click"); expect(API.post).toHaveBeenCalledTimes(1);
  await wrapper.setProps({ result: { ...result, product: "CO" } });
  resolve({ result: { score: 0.9 } }); await flushPromises();
  expect(wrapper.text()).not.toContain("0.900");
});

test("unmounting invalidates a late provider rejection", async () => {
  let reject;
  API.post.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  const wrapper = setup(); await wrapper.get("button").trigger("click"); wrapper.unmount();
  reject(new Error("network interrupted")); await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1);
});
