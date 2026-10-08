import { flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import { API } from "@/common/api";
import StructureInput from "@/components/workspace/StructureInput.vue";
import { deferred, jsonFile, mountRulePage, pendingCount, ruleItems, selectFile, session, upload } from "@/components/banlist/banlist.test-support";

let mockWorkspace;
const mockConfirm = jest.fn();
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => mockWorkspace }));
jest.mock("@/common/api", () => ({ API: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), request: jest.fn() } }));
jest.mock("vuetify-use-dialog", () => ({ useConfirm: () => mockConfirm }));
jest.mock("@/components/SmilesImage", () => ({ template: "<div />" }));
jest.mock("@/components/CopyTooltip", () => ({ template: "<slot />" }));
jest.mock("@/components/workspace/StructureInput.vue", () => ({
  props: ["modelValue", "disabled"], data: () => ({ pending: false }),
  template: '<input :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
}));
const rule = (id = "A-rule") => ({ id, user: "protocol-A", smiles: "[13CH3][C@H](O)C.[Cl-]", active: true });
let wrapper;
beforeEach(() => {
  mockWorkspace = reactive({ session: session(), allowed: true, error: "", refresh: jest.fn(),
    can: () => mockWorkspace.allowed, checking: () => false });
  API.get.mockReset().mockImplementation((url) => Promise.resolve(url.includes("chemicals") ? [rule()] : []));
  API.post.mockReset().mockResolvedValue("OK"); API.delete.mockReset().mockResolvedValue("OK");
  API.request.mockReset().mockImplementation((method, url) => API.delete(url));
  mockConfirm.mockReset().mockResolvedValue(true);
});
afterEach(() => { wrapper?.unmount(); wrapper = null; });

test("verified owner A -> B with capability still true clears collections, single and file drafts", async () => {
  wrapper = await mountRulePage();
  await wrapper.get('[data-cy="banlist-add-single-entry"]').trigger("click");
  await wrapper.get('[data-cy="banlist-new-smiles-input"]').setValue(rule().smiles);
  await wrapper.get('[data-cy="banlist-new-description"]').setValue("A private note");
  await wrapper.get('[data-cy="banlist-add-multiple-entries"]').trigger("click");
  await selectFile(wrapper, jsonFile(JSON.stringify([rule()])));
  const pending = deferred(); API.get.mockReturnValue(pending.promise);
  mockWorkspace.session = session("protocol-B"); await flushPromises();
  expect(ruleItems(wrapper)).toEqual([]);
  expect(wrapper.get('[data-cy="banlist-new-smiles-input"]').element.value).toBe("");
  expect(wrapper.get('[data-cy="banlist-new-description"]').element.value).toBe("");
  expect(wrapper.findComponent({ name: "RuleFileInput" }).props("modelValue")).toBeNull();
  expect(pendingCount(wrapper)).toBe(2);
  pending.resolve([]); await flushPromises();
});

test.each(["resolve", "reject"])("late A read %s cannot publish, show errors or release B's pending reads", async (completion) => {
  const old = deferred(); API.get.mockReturnValueOnce(old.promise).mockResolvedValue([]);
  wrapper = await mountRulePage();
  const current = deferred(); API.get.mockReturnValue(current.promise);
  mockWorkspace.session = session("protocol-B"); await flushPromises();
  old[completion](completion === "resolve" ? [rule()] : new Error("A read failed"));
  await flushPromises();
  expect(ruleItems(wrapper)).toEqual([]);
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(pendingCount(wrapper)).toBe(2);
  current.resolve([]); await flushPromises();
  expect(pendingCount(wrapper)).toBe(0);
});

test.each(["owner", "access"])("confirmation is retired on %s change even after recovery", async (change) => {
  wrapper = await mountRulePage();
  const pending = deferred(); mockConfirm.mockReturnValueOnce(pending.promise);
  await wrapper.get('[data-cy="banlist-single-delete"]').trigger("click");
  if (change === "owner") mockWorkspace.session = session("protocol-B");
  else mockWorkspace.allowed = false;
  await flushPromises(); mockWorkspace.allowed = true; await flushPromises();
  pending.resolve(true); await flushPromises();
  expect(API.delete).not.toHaveBeenCalled();
  expect(pendingCount(wrapper)).toBe(0);
});

test("reset rechecks owner before every deletion and ignores its late completion", async () => {
  API.get.mockResolvedValue([rule("first"), rule("second")]);
  wrapper = await mountRulePage();
  const pending = deferred(); API.delete.mockReturnValueOnce(pending.promise);
  await wrapper.get('[data-cy="banlist-reset"]').trigger("click"); await flushPromises();
  expect(API.delete).toHaveBeenCalledTimes(1);
  mockWorkspace.session = session("protocol-B"); API.get.mockResolvedValue([]);
  await flushPromises(); pending.resolve("OK"); await flushPromises();
  expect(API.delete).toHaveBeenCalledTimes(1);
  expect(pendingCount(wrapper)).toBe(0);
});

test.each(["resolve", "reject"])("late single-entry %s does not change B's draft, tab or notice", async (completion) => {
  wrapper = await mountRulePage();
  await wrapper.get('[data-cy="banlist-add-single-entry"]').trigger("click");
  await wrapper.get('[data-cy="banlist-new-smiles-input"]').setValue(rule().smiles);
  const pending = deferred(); API.post.mockReturnValueOnce(pending.promise);
  await wrapper.get('[data-cy="banlist-new-submit"]').trigger("click"); await flushPromises();
  mockWorkspace.session = session("protocol-B"); await flushPromises();
  await wrapper.get('[data-cy="banlist-add-single-entry"]').trigger("click");
  await wrapper.get('[data-cy="banlist-new-smiles-input"]').setValue("B draft");
  pending[completion](completion === "resolve" ? "OK" : new Error("A failed")); await flushPromises();
  expect(wrapper.get('[data-cy="banlist-new-smiles-input"]').element.value).toBe("B draft");
  expect(wrapper.find("aside").exists()).toBe(false);
  expect(pendingCount(wrapper)).toBe(0);
});

test("batch retires A rows and completion without clearing B's selected file", async () => {
  wrapper = await mountRulePage();
  await wrapper.get('[data-cy="banlist-add-multiple-entries"]').trigger("click");
  await selectFile(wrapper, jsonFile('[{"smiles":"[13CH3]CO.[Cl-]"},{"smiles":"C>>CO"}]'));
  const pending = deferred(); API.post.mockReturnValueOnce(pending.promise);
  const attempt = upload(wrapper); await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1);
  mockWorkspace.session = session("protocol-B"); await flushPromises();
  const nextFile = jsonFile('[{"smiles":"N"}]'); await selectFile(wrapper, nextFile);
  pending.resolve("OK"); await attempt; await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(wrapper.findComponent({ name: "RuleFileInput" }).props("modelValue")).toEqual(nextFile);
  expect(wrapper.find("aside").exists()).toBe(false);
  expect(pendingCount(wrapper)).toBe(0);
});

test("same-owner suspension retains drafts but cancels reads and prevents dispatch", async () => {
  wrapper = await mountRulePage();
  const field = wrapper.get('[data-cy="banlist-new-smiles-input"]'); await field.setValue(rule().smiles);
  mockWorkspace.allowed = false; await flushPromises();
  await wrapper.get('[data-cy="banlist-new-submit"]').trigger("click"); await flushPromises();
  expect(API.post).not.toHaveBeenCalled();
  mockWorkspace.allowed = true; await flushPromises();
  expect(wrapper.get('[data-cy="banlist-new-smiles-input"]').element).toBe(field.element);
  expect(field.element.value).toBe(rule().smiles);
});

test("A -> B -> A before rendering still discards both private drafts", async () => {
  wrapper = await mountRulePage();
  await wrapper.get('[data-cy="banlist-new-smiles-input"]').setValue("A private draft");
  await selectFile(wrapper, jsonFile('[{"smiles":"C"}]'));
  mockWorkspace.session = session("protocol-B"); mockWorkspace.session = session();
  await flushPromises();
  expect(wrapper.get('[data-cy="banlist-new-smiles-input"]').element.value).toBe("");
  expect(wrapper.findComponent({ name: "RuleFileInput" }).props("modelValue")).toBeNull();
});

test("an old form cannot submit under B even before Vue replaces its subtree", async () => {
  wrapper = await mountRulePage();
  await wrapper.get('[data-cy="banlist-new-smiles-input"]').setValue("A private draft");
  await selectFile(wrapper, jsonFile('[{"smiles":"C"}]'));
  const single = wrapper.findComponent({ name: "BanItemDialog" }).vm.$.setupState;
  const oldUpload = () => upload(wrapper);
  mockWorkspace.session = session("protocol-B");
  await Promise.all([single.addEntry(), oldUpload()]); await flushPromises();
  expect(API.post).not.toHaveBeenCalled();
});

test("same-owner suspension during a file read retains the file but retires that attempt", async () => {
  wrapper = await mountRulePage(); const pending = deferred();
  const file = jsonFile("[]", { text: jest.fn().mockReturnValueOnce(pending.promise).mockResolvedValue('[{"smiles":"C"}]') });
  await selectFile(wrapper, file); const attempt = upload(wrapper); await flushPromises();
  mockWorkspace.allowed = false; await attempt; await flushPromises();
  expect(pendingCount(wrapper)).toBe(0); expect(API.post).not.toHaveBeenCalled();
  expect(wrapper.findComponent({ name: "RuleFileInput" }).props("modelValue")).toEqual(file);
  mockWorkspace.allowed = true; await flushPromises();
  pending.resolve('[{"smiles":"A old row"}]'); await flushPromises();
  expect(API.post).not.toHaveBeenCalled();
  await upload(wrapper); await flushPromises(); expect(API.post).toHaveBeenCalledTimes(1);
});

test("a collection reply with another user's rows is rejected rather than relabeled", async () => {
  API.get.mockResolvedValue([{ ...rule(), user: "protocol-B" }]);
  wrapper = await mountRulePage();
  expect(ruleItems(wrapper)).toEqual([]); expect(pendingCount(wrapper)).toBe(0);
  expect(wrapper.get('[role="alert"]').text()).toContain("规则加载失败");
});

test("single entry rejects an unconfirmed structure without incrementing shared pending work", async () => {
  wrapper = await mountRulePage();
  await wrapper.get('[data-cy="banlist-new-smiles-input"]').setValue(rule().smiles);
  const input = wrapper.findComponent(StructureInput); input.vm.pending = true;
  await flushPromises();
  await wrapper.findComponent({ name: "BanItemDialog" }).vm.$.setupState.addEntry();
  expect(API.post).not.toHaveBeenCalled(); expect(pendingCount(wrapper)).toBe(0);
  input.vm.pending = false; await flushPromises();
  await wrapper.findComponent({ name: "BanItemDialog" }).vm.$.setupState.addEntry(); await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(new URLSearchParams(API.post.mock.calls[0][0].split("?")[1]).get("smiles")).toBe(rule().smiles);
});

test.each([null, session("guest_protocol"), { ...session(), workspace_access: false }, { ...session(), mode: "local" }])(
  "a capability boolean cannot substitute for verified native authority: %j", async (value) => {
    mockWorkspace.session = value;
    wrapper = await mountRulePage();
    expect(API.get).not.toHaveBeenCalled();
    await wrapper.get('[data-cy="banlist-new-smiles-input"]').setValue("C");
    await wrapper.get('[data-cy="banlist-new-submit"]').trigger("click");
    expect(API.post).not.toHaveBeenCalled();
  },
);
