import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { API } from "@/common/api";
import AnalysisList from "./AnalysisList.vue";
jest.mock("@/common/api", () => ({ API: { get: jest.fn(), post: jest.fn(), delete: jest.fn(),
  toErrorObject: (error) => ({ string_error: error.message }) } }));
jest.mock("@/components/SmilesImage.vue", () => ({ template: "<span />" }));
const row = (id = "record-a", status = "completed") => ({ id, kind: "optimization", status,
  created: "2026-10-04T00:00:00Z", structure: "" });
const data = (rows = [row()], total = rows.length) => ({ items: rows, total });
const wrappers = [];
async function setup(url = "/analyses") {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/analyses", component: { render: () => null } }] });
  await router.push(url);
  const wrapper = mount(AnalysisList, { global: { plugins: [router], stubs: {
    VBtn: { props: ["disabled", "loading"], template: '<button :disabled="disabled || loading"><slot /></button>' },
    VProgressLinear: true,
    VSelect: { props: ["modelValue", "items"], emits: ["update:modelValue"], template:
      `<select aria-label="研究类型" :value="modelValue" @change="$emit('update:modelValue', $event.target.value)">
      <option v-for="item in items" :key="item.value" :value="item.value">{{ item.title }}</option></select>` },
  } } });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router };
}
beforeEach(() => { jest.clearAllMocks(); API.get.mockReset(); });
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); jest.useRealTimers(); });
test("one mount reads one page only; history never executes or deletes", async () => {
  API.get.mockResolvedValue(data());
  const { wrapper } = await setup();
  expect(API.get.mock.calls).toEqual([["/api/v1/analyses", { limit: 25, offset: 0 }]]);
  expect(wrapper.get("tbody tr").attributes("data-record-id")).toBe("record-a");
  expect(API.post).not.toHaveBeenCalled(); expect(API.delete).not.toHaveBeenCalled();
});
test("filter changes reset pagination, hide old records, and preserve URL context on detail links", async () => {
  API.get.mockResolvedValueOnce(data([row()], 26));
  const { wrapper, router } = await setup("/analyses?page=2");
  let finish;
  API.get.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await wrapper.get("select").setValue("forward"); await flushPromises();
  expect(router.currentRoute.value.query).toEqual({ kind: "forward" });
  expect(wrapper.find("tbody").exists()).toBe(false);
  expect(wrapper.text()).not.toContain("暂无研究记录");
  expect(API.get.mock.calls[1][1]).toEqual({ kind: "forward", limit: 25, offset: 0 });
  finish(data([{ ...row("record-b"), kind: "forward" }])); await flushPromises();
  expect(wrapper.get("tbody a").attributes("href")).toBe("/analyses/record-b?kind=forward");
});
test("late pages cannot replace the current filter or end its loading state", async () => {
  let finishA, finishB;
  API.get.mockReturnValueOnce(new Promise((resolve) => { finishA = resolve; }))
    .mockReturnValueOnce(new Promise((resolve) => { finishB = resolve; }));
  const { wrapper, router } = await setup();
  await router.replace("/analyses?kind=forward"); await flushPromises();
  finishA(data()); await flushPromises();
  expect(wrapper.attributes("aria-busy")).toBe("true");
  expect(wrapper.find("tbody").exists()).toBe(false);
  finishB(data([{ ...row("record-b"), kind: "forward" }])); await flushPromises();
  expect(wrapper.get("tbody tr").attributes("data-record-id")).toBe("record-b");
});
test("empty, malformed, and failed lists remain separate and support explicit retry", async () => {
  API.get.mockResolvedValueOnce(data([]));
  const { wrapper } = await setup();
  expect(wrapper.text()).toContain("暂无研究记录");
  API.get.mockResolvedValueOnce({ items: null, total: 1 });
  await wrapper.get('[aria-label="刷新研究记录"]').trigger("click"); await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("格式无效");
  expect(wrapper.text()).not.toContain("暂无研究记录");
  API.get.mockRejectedValueOnce(new Error("connection failed"));
  await wrapper.get('[aria-label="刷新研究记录"]').trigger("click"); await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe("connection failed");
  API.get.mockResolvedValue(data());
  await wrapper.get('[aria-label="刷新研究记录"]').trigger("click"); await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
});
test("a shrinking list redirects once to its real last page", async () => {
  API.get.mockResolvedValueOnce(data([], 1)).mockResolvedValueOnce(data());
  const { wrapper, router } = await setup("/analyses?page=8");
  expect(router.currentRoute.value.query.page).toBeUndefined();
  expect(API.get).toHaveBeenCalledTimes(2);
  expect(wrapper.get('[aria-label="下一页"]').element.disabled).toBe(true);
});
test("invalid URL parameters fail before a request; running pages poll and release on unmount", async () => {
  const invalid = await setup("/analyses?page=NaN");
  expect(API.get).not.toHaveBeenCalled();
  expect(invalid.wrapper.get('[role="alert"]').text()).toContain("页码无效");
  invalid.wrapper.unmount();
  API.get.mockResolvedValue(data([row("running", "running")]));
  jest.useFakeTimers();
  const current = await setup();
  expect(API.get).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(10000); await flushPromises();
  expect(API.get).toHaveBeenCalledTimes(2);
  current.wrapper.unmount();
  jest.advanceTimersByTime(10000); await flushPromises();
  expect(API.get).toHaveBeenCalledTimes(2);
});
