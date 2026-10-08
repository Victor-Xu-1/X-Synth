import { defineComponent, reactive, ref, watch } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import Admin from "./Admin.vue";
import { API } from "@/common/api";

let mockWorkspace;
const mockConfirm = jest.fn(), mockReplace = jest.fn();
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => mockWorkspace }));
jest.mock("vue-router", () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock("vuetify-use-dialog", () => ({ useConfirm: () => mockConfirm }));
jest.mock("@/common/api", () => ({ API: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), clearAuthState: jest.fn() } }));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const profile = (username = "researcher") => ({ username, disabled: false, email: `${username}@example.invalid`, full_name: "Protocol fixture", last_login: null });
const session = (updates = {}) => ({ mode: "askcos", owner: "researcher", administrator: false, workspace_access: true, ...updates });
const Dialog = defineComponent({
  props: ["modelValue", "mode", "username", "initialEmail", "loading", "error", "contextKey"],
  emits: ["save", "update:modelValue"],
  setup(props) {
    const draft = ref(props.initialEmail);
    watch(() => props.modelValue, (open) => { if (open) draft.value = props.initialEmail; });
    return { draft };
  },
  template: '<div v-if="modelValue" class="protocol-dialog"><input aria-label="邮箱草稿" v-model="draft" /><button class="save" @click="$emit(\'save\', { username, email: draft })">保存</button></div>',
});
const wrappers = [];
async function setup({ realDialog = false } = {}) {
  const wrapper = mount(Admin, { global: { stubs: {
    ModuleWorkbench: { template: '<section><slot name="actions" /><slot /></section>' },
    AccountUserDialog: realDialog ? false : Dialog, RouterLink: true, VIcon: true, VProgressLinear: true,
    VBtn: { props: ["disabled", "loading"], template: '<button :disabled="disabled || loading"><slot /></button>' },
    VSelect: true, VCheckbox: true, VMenu: true, VList: true, VListItem: true, Timeago: true,
    VDataTable: { props: ["items"], template: '<div class="private-users"><span v-for="item in items" :key="item.username">{{ item.username }}</span></div>' },
    VDialog: { props: ["modelValue"], template: '<div v-if="modelValue"><slot /></div>' },
    VForm: defineComponent({
      setup(_, { expose }) { expose({ validate: async () => ({ valid: true }) }); },
      template: '<form><slot /></form>',
    }),
    VCard: { template: '<section><slot /></section>' }, VCardTitle: { template: '<h2><slot /></h2>' },
    VCardText: { template: '<div><slot /></div>' }, VCardActions: { template: '<footer><slot /></footer>' },
    VSpacer: true, VAlert: true,
    VTextField: { props: ["modelValue", "label"], emits: ["update:modelValue"], template: '<input :aria-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  } } });
  wrappers.push(wrapper); await flushPromises(); return wrapper;
}
beforeEach(() => {
  jest.clearAllMocks(); API.get.mockReset(); API.post.mockReset(); API.delete.mockReset();
  mockWorkspace = reactive({ session: session(), error: "", loading: false, refreshed: 1,
    refresh: jest.fn().mockResolvedValue(undefined),
    can(feature) { return !this.error && this.session?.mode === "askcos" && (feature !== "administrator" || this.session.administrator === true); },
  });
  API.get.mockImplementation((url) => Promise.resolve(url.endsWith("get-current-user") ? profile(mockWorkspace.session?.owner)
    : url.endsWith("am-i-superuser") ? mockWorkspace.session?.administrator === true : [profile("colleague")]));
  API.post.mockResolvedValue("OK"); API.delete.mockResolvedValue("OK"); mockConfirm.mockResolvedValue(true);
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("native ordinary accounts retain existing own-profile actions and never fetch the admin list", async () => {
  const wrapper = await setup();
  expect(wrapper.find(".account-profile").exists()).toBe(true);
  expect(API.get.mock.calls.some(([url]) => url.endsWith("get-all-users"))).toBe(false);
  await wrapper.vm.openEditor("email", wrapper.vm.currentUser); await flushPromises();
  await wrapper.get('[aria-label="邮箱草稿"]').setValue("edited@example.invalid");
  await wrapper.get(".save").trigger("click"); await flushPromises();
  expect(API.post).toHaveBeenCalledWith("/api/user/update", expect.objectContaining({ username: "researcher", email: "edited@example.invalid" }), true);
});

test("the production Admin binding initializes the real account dialog with the current email", async () => {
  const wrapper = await setup({ realDialog: true });
  wrapper.vm.openEditor("email", wrapper.vm.currentUser); await flushPromises();
  expect(wrapper.get('[aria-label="邮箱"]').element.value).toBe("researcher@example.invalid");
});

test("the real account dialog preserves drafts through identical native-session polling", async () => {
  const wrapper = await setup({ realDialog: true });
  wrapper.vm.openEditor("email", wrapper.vm.currentUser); await flushPromises();
  const field = wrapper.get('[aria-label="邮箱"]').element;
  await wrapper.get('[aria-label="邮箱"]').setValue("unsaved@example.invalid");
  mockWorkspace.loading = true; mockWorkspace.session = { ...mockWorkspace.session }; await flushPromises();
  expect(wrapper.get('[aria-label="邮箱"]').element).toBe(field);
  expect(wrapper.get('[aria-label="邮箱"]').element.value).toBe("unsaved@example.invalid");
});

test("background loading and identical core-session replacement retain profile, open form and draft", async () => {
  const wrapper = await setup();
  await wrapper.vm.openEditor("email", wrapper.vm.currentUser); await flushPromises();
  const region = wrapper.get(".account-profile").element;
  await wrapper.get('[aria-label="邮箱草稿"]').setValue("unsaved@example.invalid");
  mockWorkspace.loading = true; mockWorkspace.session = { ...mockWorkspace.session }; await flushPromises();
  expect(wrapper.get(".account-profile").element).toBe(region);
  expect(wrapper.get('[aria-label="邮箱草稿"]').element.value).toBe("unsaved@example.invalid");
  expect(API.get).toHaveBeenCalledTimes(2);
});

test.each([session({ mode: "local", administrator: true }), session({ owner: "guest_protocol" }), null])("inappropriate account authority performs no native account reads: %j", async (value) => {
  mockWorkspace.session = value;
  const wrapper = await setup();
  expect(API.get).not.toHaveBeenCalled();
  expect(wrapper.find(".account-profile").exists()).toBe(false);
});

test("ordinary-account handlers cannot create users or target another profile", async () => {
  const wrapper = await setup();
  await wrapper.vm.openEditor("new"); await flushPromises();
  expect(wrapper.find(".protocol-dialog").exists()).toBe(false);
  await wrapper.vm.openEditor("email", profile("colleague")); await flushPromises();
  expect(wrapper.find(".protocol-dialog").exists()).toBe(false);
  await wrapper.vm.applyAction(["colleague"], "delete"); await flushPromises();
  expect(mockConfirm).not.toHaveBeenCalled(); expect(API.delete).not.toHaveBeenCalled();
});

test("identity changes clear private state and close editors before loading the next owner", async () => {
  const wrapper = await setup();
  await wrapper.vm.openEditor("email", wrapper.vm.currentUser); await flushPromises();
  mockWorkspace.session = session({ owner: "another" }); await flushPromises();
  expect(wrapper.vm.currentUser.username).toBe("another");
  expect(wrapper.find(".protocol-dialog").exists()).toBe(false);
});

test("administrator loss removes private lists and retains only newly verified own-profile access", async () => {
  mockWorkspace.session = session({ administrator: true });
  const wrapper = await setup();
  expect(wrapper.find(".private-users").exists()).toBe(true);
  mockWorkspace.session = session(); await flushPromises();
  expect(wrapper.find(".private-users").exists()).toBe(false);
  expect(wrapper.vm.isAdmin).toBe(false); expect(wrapper.vm.users).toEqual([]);
});

test("a late profile reply cannot publish after session loss or request an admin list", async () => {
  const pending = deferred(); mockWorkspace.session = session({ administrator: true });
  API.get.mockReturnValueOnce(pending.promise);
  const wrapper = await setup();
  mockWorkspace.session = null; await flushPromises();
  pending.resolve(profile()); await flushPromises();
  expect(wrapper.vm.currentUser).toBeNull(); expect(wrapper.vm.users).toEqual([]);
  expect(API.get).toHaveBeenCalledTimes(1);
});

test("lost authority during a confirmation cannot submit the pending mutation", async () => {
  mockWorkspace.session = session({ administrator: true });
  const wrapper = await setup(); const pending = deferred(); mockConfirm.mockReturnValueOnce(pending.promise);
  const operation = wrapper.vm.applyAction(["colleague"], "delete");
  mockWorkspace.session = session({ mode: "local", administrator: true }); await flushPromises();
  pending.resolve(true); await operation; await flushPromises();
  expect(API.delete).not.toHaveBeenCalled(); expect(API.clearAuthState).not.toHaveBeenCalled();
});

test("late save completion cannot close or overwrite a new owner's editor", async () => {
  const wrapper = await setup(); const pending = deferred();
  wrapper.vm.openEditor("email", wrapper.vm.currentUser);
  API.post.mockReturnValueOnce(pending.promise);
  const operation = wrapper.vm.submitEditor({ username: "researcher", email: "first@example.invalid" });
  mockWorkspace.session = session({ owner: "another" }); await flushPromises();
  wrapper.vm.openEditor("email", wrapper.vm.currentUser); await flushPromises();
  await wrapper.get('[aria-label="邮箱草稿"]').setValue("unsaved@example.invalid");
  pending.resolve("OK"); await operation; await flushPromises();
  expect(wrapper.vm.currentUser.username).toBe("another");
  expect(wrapper.vm.editorOpen).toBe(true);
  expect(wrapper.get('[aria-label="邮箱草稿"]').element.value).toBe("unsaved@example.invalid");
  expect(wrapper.vm.notice).toBe("");
  expect(API.get).toHaveBeenCalledTimes(4);
});

test("a late self-delete reply cannot sign out a different current identity", async () => {
  const wrapper = await setup(); const pending = deferred();
  API.delete.mockReturnValueOnce(pending.promise);
  const operation = wrapper.vm.applyAction(["researcher"], "delete"); await flushPromises();
  expect(API.delete).toHaveBeenCalledTimes(1);
  mockWorkspace.session = session({ owner: "another" }); await flushPromises();
  pending.resolve("OK"); await operation; await flushPromises();
  expect(wrapper.vm.currentUser.username).toBe("another");
  expect(API.clearAuthState).not.toHaveBeenCalled(); expect(mockReplace).not.toHaveBeenCalled();
});

test("returning to the same identity does not resurrect a read from before authority loss", async () => {
  const pending = deferred(); API.get.mockReturnValueOnce(pending.promise);
  const wrapper = await setup(); const signal = API.get.mock.calls[0][3].signal;
  mockWorkspace.session = null; await flushPromises();
  expect(signal.aborted).toBe(true);
  mockWorkspace.session = session(); await flushPromises();
  expect(wrapper.vm.currentUser.email).toBe("researcher@example.invalid");
  pending.resolve({ ...profile(), email: "stale@example.invalid" }); await flushPromises();
  expect(wrapper.vm.currentUser.email).toBe("researcher@example.invalid");
  expect(API.get).toHaveBeenCalledTimes(3);
});

test("role loss between bulk mutations stops the remaining privileged requests", async () => {
  mockWorkspace.session = session({ administrator: true });
  API.get.mockImplementation((url) => Promise.resolve(url.endsWith("get-current-user") ? profile()
    : url.endsWith("am-i-superuser") ? mockWorkspace.session.administrator : [profile("colleague"), profile("another")]));
  const wrapper = await setup(); const pending = deferred(); API.post.mockReturnValueOnce(pending.promise);
  const operation = wrapper.vm.applyAction(["colleague", "another"], "disable"); await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1);
  mockWorkspace.session = session(); await flushPromises();
  pending.resolve("OK"); await operation; await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(wrapper.vm.users).toEqual([]); expect(wrapper.vm.isAdmin).toBe(false);
});

test("self demotion revalidates native authority before sending the next bulk mutation", async () => {
  mockWorkspace.session = session({ administrator: true });
  API.get.mockImplementation((url) => Promise.resolve(url.endsWith("get-current-user") ? profile()
    : url.endsWith("am-i-superuser") ? mockWorkspace.session.administrator
      : url.endsWith("/demote") ? "OK" : [profile("colleague")]));
  const wrapper = await setup();
  mockWorkspace.refresh.mockImplementationOnce(async () => { mockWorkspace.session = session(); });
  await wrapper.vm.applyAction(["researcher", "colleague"], "normal"); await flushPromises();
  expect(API.get.mock.calls.filter(([url]) => url.endsWith("/demote"))).toHaveLength(1);
  expect(mockWorkspace.refresh).toHaveBeenLastCalledWith(true);
  expect(wrapper.vm.isAdmin).toBe(false); expect(wrapper.vm.users).toEqual([]);
});

test("editor submissions cannot switch target or inject privilege fields", async () => {
  const wrapper = await setup(); wrapper.vm.openEditor("email", wrapper.vm.currentUser);
  await wrapper.vm.submitEditor({ username: "another", email: "other@example.invalid" });
  expect(API.post).not.toHaveBeenCalled();
  await wrapper.vm.submitEditor({ username: "researcher", email: "own@example.invalid", disabled: true, is_superuser: true });
  expect(API.post).toHaveBeenCalledWith("/api/user/update", {
    username: "researcher", email: "own@example.invalid", disabled: false, full_name: "Protocol fixture",
  }, true);
});

test("an active read failure clears private state and remains explicitly retryable", async () => {
  const wrapper = await setup(); API.get.mockRejectedValueOnce(new Error("protocol unavailable"));
  await wrapper.vm.fetchData(); await flushPromises();
  expect(wrapper.vm.currentUser).toBeNull(); expect(wrapper.vm.dataLoading).toBe(false);
  expect(wrapper.vm.dataError).toBeTruthy();
  await wrapper.vm.fetchData(); await flushPromises();
  expect(wrapper.vm.currentUser.username).toBe("researcher"); expect(wrapper.vm.dataError).toBe("");
});

test("unmount aborts a profile read and rejects its late continuation", async () => {
  const pending = deferred(); API.get.mockReturnValueOnce(pending.promise);
  const wrapper = await setup(); const signal = API.get.mock.calls[0][3].signal;
  wrapper.unmount(); expect(signal.aborted).toBe(true);
  pending.resolve(profile()); await flushPromises();
  expect(API.get).toHaveBeenCalledTimes(1);
});
