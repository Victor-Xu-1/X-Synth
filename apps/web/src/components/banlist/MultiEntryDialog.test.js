import { flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import { API } from "@/common/api";
import MultiEntryDialog from "./MultiEntryDialog.vue";
import { ruleRequestTimeoutMs } from "./rule-owner-scope";
import { deferred, jsonFile, mountRulePage, pendingCount, selectFile, session, upload } from "./banlist.test-support";

let mockWorkspace, wrapper;
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => mockWorkspace }));
jest.mock("@/common/api", () => ({ API: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), request: jest.fn() } }));
jest.mock("vuetify-use-dialog", () => ({ useConfirm: () => jest.fn() }));
jest.mock("@/components/SmilesImage", () => ({ template: "<div />" }));
jest.mock("@/components/CopyTooltip", () => ({ template: "<slot />" }));
jest.mock("@/components/workspace/StructureInput.vue", () => ({ template: "<div />" }));
beforeEach(() => {
  mockWorkspace = reactive({ session: session(), error: "", can: () => true, refresh: jest.fn() });
  API.get.mockReset().mockResolvedValue([]); API.post.mockReset().mockResolvedValue("OK");
});
afterEach(() => { wrapper?.unmount(); wrapper = null; });

test.each([
  ["syntax", "["], ["null array", "null"], ["object", "{}"], ["empty array", "[]"],
  ["late null row", '[{"smiles":"C"},null]'], ["number smiles", '[{"smiles":12}]'],
  ["object smiles", '[{"smiles":{}}]'], ["blank smiles", '[{"smiles":" "}]'],
  ["string active", '[{"smiles":"C","active":"false"}]'],
  ["object description", '[{"smiles":"C","description":{}}]'],
])("invalid %s is atomic, releases pending work and allows a successful retry", async (label, content) => {
  wrapper = await mountRulePage();
  await wrapper.get('[data-cy="banlist-add-multiple-entries"]').trigger("click");
  await selectFile(wrapper, jsonFile(content));
  await upload(wrapper).catch(() => {}); await flushPromises();
  expect(API.post).not.toHaveBeenCalled();
  expect(pendingCount(wrapper)).toBe(0);
  expect(wrapper.get("aside").text()).not.toContain("已成功添加");
  await selectFile(wrapper, jsonFile('[{"smiles":"[13CH3][C@H](O)C.[Cl-]","active":false,"description":"source note"}]'));
  await upload(wrapper); await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1);
  const params = new URLSearchParams(API.post.mock.calls[0][0].split("?")[1]);
  expect(params.get("smiles")).toBe("[13CH3][C@H](O)C.[Cl-]");
  expect(params.get("active")).toBe("false"); expect(params.get("description")).toBe("source note");
  expect(pendingCount(wrapper)).toBe(0);
});

test("a failed file read is owned, actionable and retryable", async () => {
  wrapper = await mountRulePage();
  await selectFile(wrapper, jsonFile("[]", { text: jest.fn().mockRejectedValue(new Error("read failed")) }));
  await upload(wrapper).catch(() => {}); await flushPromises();
  expect(pendingCount(wrapper)).toBe(0); expect(API.post).not.toHaveBeenCalled();
  expect(wrapper.find("aside").exists()).toBe(true);
  await selectFile(wrapper, jsonFile('[{"smiles":"C"}]')); await upload(wrapper); await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1); expect(pendingCount(wrapper)).toBe(0);
});

test("duplicate upload calls are serialized during the entire file read", async () => {
  wrapper = await mountRulePage();
  const pending = deferred(), file = jsonFile("[]", { text: jest.fn().mockReturnValue(pending.promise) });
  await selectFile(wrapper, file);
  const first = upload(wrapper), second = upload(wrapper); await flushPromises();
  expect(file.text).toHaveBeenCalledTimes(1); expect(pendingCount(wrapper)).toBe(1);
  pending.resolve('[{"smiles":"C"}]'); await Promise.all([first, second]); await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1); expect(pendingCount(wrapper)).toBe(0);
});

test("oversized files are rejected before reading or dispatching", async () => {
  wrapper = await mountRulePage(); const file = jsonFile('[{"smiles":"C"}]', { size: 2 * 1024 * 1024 + 1 });
  await selectFile(wrapper, file); await upload(wrapper); await flushPromises();
  expect(file.text).not.toHaveBeenCalled(); expect(API.post).not.toHaveBeenCalled();
  expect(pendingCount(wrapper)).toBe(0);
});

test("batch row counts are bounded before any post", async () => {
  wrapper = await mountRulePage();
  await selectFile(wrapper, jsonFile(JSON.stringify(Array.from({ length: 101 }, () => ({ smiles: "C" })))));
  await upload(wrapper); await flushPromises();
  expect(API.post).not.toHaveBeenCalled(); expect(pendingCount(wrapper)).toBe(0);
});

test("a stalled file read releases the page's pending counter on timeout and can be retried", async () => {
  wrapper = await mountRulePage();
  const file = jsonFile("[]", { text: jest.fn().mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValue('[{"smiles":"C"}]') });
  await selectFile(wrapper, file);
  jest.useFakeTimers();
  try {
    const attempt = upload(wrapper); await jest.advanceTimersByTimeAsync(ruleRequestTimeoutMs); await attempt;
    expect(pendingCount(wrapper)).toBe(0); expect(jest.getTimerCount()).toBe(0);
    expect(API.post).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
  await flushPromises(); expect(wrapper.get("aside").text()).toContain("读取失败或超时");
  await upload(wrapper); await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1); expect(pendingCount(wrapper)).toBe(0);
});

test("normal close cancels an in-progress file read without leaving shared pending work", async () => {
  wrapper = await mountRulePage(); const pending = deferred();
  await selectFile(wrapper, jsonFile("[]", { text: () => pending.promise }));
  const attempt = upload(wrapper); await flushPromises();
  wrapper.findComponent(MultiEntryDialog).vm.$.setupState.closeDialog();
  await attempt; await flushPromises();
  expect(pendingCount(wrapper)).toBe(0); expect(API.post).not.toHaveBeenCalled();
  pending.resolve('[{"smiles":"C"}]'); await flushPromises();
  expect(API.post).not.toHaveBeenCalled(); expect(wrapper.find("aside").exists()).toBe(false);
});

test("a valid batch preserves per-row partial failure reporting and releases pending work", async () => {
  wrapper = await mountRulePage();
  API.post.mockRejectedValueOnce(new Error("protocol failure"));
  await selectFile(wrapper, jsonFile('[{"smiles":"C"},{"smiles":"C>>CO"}]'));
  await upload(wrapper); await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(2); expect(pendingCount(wrapper)).toBe(0);
  expect(wrapper.get("aside").text()).toContain("1 条反应记录，1 条记录失败");
});
