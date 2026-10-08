import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import AccountUserDialog from "./AccountUserDialog.vue";
const mockValidate = jest.fn();
const Form = defineComponent({
  emits: ["submit"],
  setup(_, { expose }) { expose({ validate: () => mockValidate() }); },
  template: '<form @submit.prevent="$emit(\'submit\')"><slot /></form>',
});
const wrappers = [];
async function setup() {
  const wrapper = mount(AccountUserDialog, { props: { modelValue: false, mode: "email", username: "researcher",
    initialEmail: "protocol@example.invalid", contextKey: "protocol-owner-role" }, global: { stubs: {
    VDialog: { props: ["modelValue"], template: '<div v-if="modelValue"><slot /></div>' },
    VForm: Form, VCard: { template: '<section><slot /></section>' },
    VCardTitle: { template: '<h2><slot /></h2>' }, VCardText: { template: '<div><slot /></div>' },
    VCardActions: { template: '<footer><slot /></footer>' }, VSpacer: true, VAlert: true,
    VBtn: { template: '<button><slot /></button>' },
    VTextField: { props: ["modelValue", "label"], emits: ["update:modelValue"], template: '<input :aria-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  } } });
  wrappers.push(wrapper); await wrapper.setProps({ modelValue: true }); return wrapper;
}
beforeEach(() => mockValidate.mockReset().mockResolvedValue({ valid: true }));
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
test("successful validation emits only the captured account editor and authority context", async () => {
  const wrapper = await setup(); await wrapper.get('[aria-label="邮箱"]').setValue("edited@example.invalid");
  await wrapper.vm.submit();
  expect(wrapper.emitted("save")).toEqual([[{ username: "researcher", email: "edited@example.invalid" }, "protocol-owner-role"]]);
});
test.each(["close", "identity", "role", "unmount"])("late form validation after %s cannot emit a stale save", async (change) => {
  const wrapper = await setup(); let finish;
  mockValidate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const operation = wrapper.vm.submit();
  if (change === "close") await wrapper.setProps({ modelValue: false });
  if (change === "identity") await wrapper.setProps({ username: "another", contextKey: "another-owner" });
  if (change === "role") await wrapper.setProps({ contextKey: "changed-role" });
  if (change === "unmount") wrapper.unmount();
  finish({ valid: true }); await operation; await flushPromises();
  expect(wrapper.emitted("save")).toBeUndefined();
});
test("identical authority polling does not reset an in-progress email draft", async () => {
  const wrapper = await setup(); await wrapper.get('[aria-label="邮箱"]').setValue("unsaved@example.invalid");
  await wrapper.setProps({ contextKey: "protocol-owner-role" });
  expect(wrapper.get('[aria-label="邮箱"]').element.value).toBe("unsaved@example.invalid");
});
test("opening a different editor initializes email after all incoming props settle", async () => {
  const wrapper = await setup();
  await wrapper.setProps({ modelValue: false, username: "", initialEmail: "" });
  await wrapper.setProps({ modelValue: true, username: "colleague", initialEmail: "colleague@example.invalid" });
  expect(wrapper.get('[aria-label="邮箱"]').element.value).toBe("colleague@example.invalid");
});
