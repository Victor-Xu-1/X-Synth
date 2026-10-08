import { mount, flushPromises } from "@vue/test-utils";
import { TextEncoder } from "node:util";
import { createRouter, createMemoryHistory } from "vue-router";
import { API } from "@/common/api";
import { saveAs } from "file-saver";
import AnalysisDetail from "./AnalysisDetail.vue";
jest.mock("file-saver", () => ({ saveAs: jest.fn() }));
jest.mock("@/common/api", () => ({ API: { get: jest.fn(), post: jest.fn(), delete: jest.fn(),
  toErrorObject: (error) => ({ string_error: error.message }) } }));
jest.mock("./AnalysisResult.vue", () => ({ props: ["kind", "result"], template: '<div class="read-only-result">{{ kind }}</div>' }));
const record = (id = "record-a", status = "completed") => ({ id, kind: "forward", status,
  created: "2026-10-04T00:00:00Z", inputs: { note: id }, result: status === "completed" ? {} : null, error: null });
const wrappers = [];
async function setup(url = "/analyses/record-a") {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/analyses/:id", component: { render: () => null } }] });
  await router.push(url);
  const wrapper = mount(AnalysisDetail, { global: { plugins: [router], stubs: {
    VIcon: true,
    VBtn: { props: ["disabled", "loading"], template: '<button :disabled="disabled || loading"><slot /></button>' },
  } } });
  wrappers.push(wrapper); await flushPromises(); return { wrapper, router };
}
beforeEach(() => { jest.clearAllMocks(); API.get.mockReset(); });
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); jest.useRealTimers(); jest.restoreAllMocks(); });
test("deep link and refresh read only, with list filter/page retained on the return link", async () => {
  API.get.mockResolvedValue(record());
  const { wrapper } = await setup("/analyses/record-a?kind=forward&page=2");
  expect(API.get.mock.calls).toEqual([["/api/v1/analyses/record-a", null, false]]);
  expect(wrapper.findAll("button")[0].attributes("to")).toBeDefined();
  await wrapper.get('[aria-label="刷新研究记录"]').trigger("click"); await flushPromises();
  expect(API.get).toHaveBeenCalledTimes(2);
  expect(API.post).not.toHaveBeenCalled(); expect(API.delete).not.toHaveBeenCalled();
});
test("route changes clear old result/input immediately and late responses cannot overwrite the selected record", async () => {
  let finishA;
  API.get.mockReturnValueOnce(new Promise((resolve) => { finishA = resolve; })).mockResolvedValueOnce(record("record-b"));
  const { wrapper, router } = await setup();
  await router.replace("/analyses/record-b"); await flushPromises();
  finishA(record()); await flushPromises();
  expect(JSON.parse(wrapper.get("pre").text())).toEqual({ note: "record-b" });
  expect(wrapper.attributes("aria-busy")).toBe("false");
});
test("failed reads expose retry, do not retain stale records, and reject response-ID mismatches", async () => {
  API.get.mockRejectedValueOnce(new Error("not found")).mockResolvedValueOnce(record("wrong-id")).mockResolvedValueOnce(record());
  const { wrapper } = await setup();
  expect(wrapper.get('[role="alert"]').text()).toBe("not found");
  await wrapper.get('[aria-label="刷新研究记录"]').trigger("click"); await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("不符");
  expect(wrapper.find("pre").exists()).toBe(false);
  await wrapper.get('[aria-label="刷新研究记录"]').trigger("click"); await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
});
test("running records poll without losing input; completed records stop polling and unmount releases it", async () => {
  jest.useFakeTimers();
  API.get.mockResolvedValueOnce(record("record-a", "running")).mockResolvedValue(record());
  const { wrapper } = await setup();
  expect(wrapper.text()).toContain("仍在执行");
  jest.advanceTimersByTime(10000); await flushPromises();
  expect(wrapper.find(".read-only-result").exists()).toBe(true);
  jest.advanceTimersByTime(10000); await flushPromises();
  expect(API.get).toHaveBeenCalledTimes(2);
  wrapper.unmount();
  jest.advanceTimersByTime(10000); await flushPromises();
  expect(API.get).toHaveBeenCalledTimes(2);
});
test("failed/interrupted records never gain result or download controls", async () => {
  API.get.mockResolvedValueOnce({ ...record("record-a", "failed"), error: "recorded failure" })
    .mockResolvedValueOnce(record("record-a", "interrupted"));
  const { wrapper } = await setup();
  expect(wrapper.get('[role="alert"]').text()).toBe("recorded failure");
  expect(wrapper.find('[aria-label="下载研究记录"]').exists()).toBe(false);
  await wrapper.get('[aria-label="刷新研究记录"]').trigger("click"); await flushPromises();
  expect(wrapper.text()).toContain("已中断");
});
test("download serializes the exact loaded record without requests and revokes its URL", async () => {
  const known = record(); API.get.mockResolvedValue(known);
  const create = jest.fn().mockReturnValue("blob:owned-record"), revoke = jest.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
  const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const { wrapper } = await setup();
  await wrapper.get('[aria-label="下载研究记录"]').trigger("click");
  const text = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(create.mock.calls[0][0]); });
  expect(JSON.parse(text)).toEqual(known); expect(click).toHaveBeenCalledTimes(1);
  expect(API.get).toHaveBeenCalledTimes(1); expect(API.post).not.toHaveBeenCalled();
  wrapper.unmount(); expect(revoke).toHaveBeenCalledWith("blob:owned-record");
});

test("saved optimization CSV downloads verbatim with blank measured responses and no recomputation", async () => {
  // Export protocol bytes only, not a scientific result or acceptance fixture.
  const csv = 'recommendation,factor,response,posterior_mean\r\n1,"quoted, level",,0\r\n';
  const known = { ...record(), kind: "optimization", result: {
    engine: "BayBE", empirically_confirmed: false, csv_content: csv,
    recommendations: [{ conditions: { factor: "quoted, level" } }],
    target: { name: "response" }, versions: { baybe: "0.15.0" }, selected_rows: [1, 2, 3],
  } };
  API.get.mockResolvedValue(known);
  const { wrapper } = await setup();
  await wrapper.get('[aria-label="导出下一批实验 CSV"]').trigger("click");
  expect(saveAs).toHaveBeenCalledTimes(1);
  const [blob, name] = saveAs.mock.calls[0];
  const text = await new Promise((resolve) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob);
  });
  expect(text).toBe(csv);
  expect(blob.size).toBe(new TextEncoder().encode(csv).length);
  expect(name).toBe("X-Synth-optimization-record-a.csv");
  expect(known.result.csv_content).toBe(csv);
  expect(API.get).toHaveBeenCalledTimes(1);
  expect(API.post).not.toHaveBeenCalled(); expect(API.delete).not.toHaveBeenCalled();
});

test("missing or non-optimization CSV has no export action", async () => {
  API.get.mockResolvedValue({ ...record(), kind: "optimization" });
  const { wrapper } = await setup();
  expect(wrapper.find('[aria-label="导出下一批实验 CSV"]').exists()).toBe(false);
  API.get.mockResolvedValue({ ...record(), result: { csv_content: "not an optimization export" } });
  await wrapper.get('[aria-label="刷新研究记录"]').trigger("click"); await flushPromises();
  expect(wrapper.find('[aria-label="导出下一批实验 CSV"]').exists()).toBe(false);
});

test("navigation and failed reads immediately remove the previous record's CSV export", async () => {
  const known = { ...record(), kind: "optimization", result: {
    engine: "BayBE", empirically_confirmed: false, csv_content: "stored protocol bytes",
    recommendations: [{ conditions: {} }],
  } };
  let rejectRead;
  API.get.mockResolvedValueOnce(known).mockReturnValueOnce(new Promise((_, reject) => { rejectRead = reject; }));
  const { wrapper, router } = await setup();
  expect(wrapper.find('[aria-label="导出下一批实验 CSV"]').exists()).toBe(true);
  await router.replace("/analyses/record-b"); await flushPromises();
  expect(wrapper.find('[aria-label="导出下一批实验 CSV"]').exists()).toBe(false);
  rejectRead(new Error("read failed")); await flushPromises();
  expect(wrapper.find('[aria-label="导出下一批实验 CSV"]').exists()).toBe(false);
  expect(saveAs).not.toHaveBeenCalled();
  expect(API.post).not.toHaveBeenCalled(); expect(API.delete).not.toHaveBeenCalled();
});
