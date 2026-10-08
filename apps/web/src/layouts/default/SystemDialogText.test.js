import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import SystemDialogText, { systemConfirm } from "./SystemDialogText.vue";
import BanNotice from "@/components/banlist/BanNotice.vue";
import { initializeLocale, setLocale } from "@/i18n";

const stubs = { VCardTitle: { template: "<h2><slot /></h2>" }, VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VSpacer: true, VSnackbar: { template: '<aside><slot /><slot name="actions" /></aside>' } };

test("open confirmation title, named counts and buttons react without invoking its callbacks", async () => {
  initializeLocale(null);
  const cancel = jest.fn(), confirm = jest.fn();
  const options = systemConfirm("删除账号", "确定删除 {count} 个账号？此操作无法撤销。", { count: 2 }, { width: 440 });
  const wrapper = mount(defineComponent({ setup: () => () => h("section", [
    h(options.titleComponent, options.titleComponentProps), h(options.contentComponent, options.contentComponentProps),
    h(options.actionsContentComponent, { cancel, confirm, confirmationButtonDisabled: false }),
  ]) }), { global: { stubs } });
  expect(wrapper.text()).toContain("Delete 2 accounts?");
  expect(wrapper.findAll("button").map((button) => button.text())).toEqual(["Cancel", "Confirm"]);
  expect(options.dialogProps["aria-labelledby"]).toBe(wrapper.get("h2").attributes("id"));
  const heading = wrapper.get("h2").element;
  setLocale("zh-CN", { persist: false }); await flushPromises();
  expect(wrapper.text()).toContain("确定删除 2 个账号？");
  expect(wrapper.get("h2").element).toBe(heading);
  expect(cancel).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  wrapper.unmount();
});

test("notification close labels and full named messages switch while the same message remains selected", async () => {
  initializeLocale(null);
  const message = { source: "已添加 {chemicals} 条化合物记录，{failed} 条记录失败。", values: { chemicals: 2, failed: 1 }, color: "warning" };
  const before = JSON.stringify(message);
  const wrapper = mount(BanNotice, { props: { modelValue: true, message }, global: { stubs } });
  expect(wrapper.text()).toContain("Added compound records: 2; failed records: 1.");
  expect(wrapper.get("button").text()).toBe("Close");
  setLocale("zh-CN", { persist: false }); await flushPromises();
  expect(wrapper.text()).toContain("已添加 2 条化合物记录，1 条记录失败。");
  expect(wrapper.get("button").text()).toBe("关闭");
  expect(JSON.stringify(message)).toBe(before);
  expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  await wrapper.get("button").trigger("click");
  expect(wrapper.emitted("update:modelValue")).toEqual([[false]]);
  expect(JSON.stringify(message)).toBe(before);
  wrapper.unmount();
});

test("confirmation actions keep their disabled guard and only invoke the selected callback", async () => {
  initializeLocale(null);
  const cancel = jest.fn(), confirm = jest.fn();
  const options = systemConfirm("删除规则", "确定删除此条禁用规则？");
  const wrapper = mount(options.actionsContentComponent, { props: { cancel, confirm, confirmationButtonDisabled: true }, global: { stubs } });
  await wrapper.findAll("button")[1].trigger("click");
  expect(confirm).not.toHaveBeenCalled();
  await wrapper.findAll("button")[0].trigger("click");
  expect(cancel).toHaveBeenCalledTimes(1);
  await wrapper.setProps({ confirmationButtonDisabled: false });
  await wrapper.findAll("button")[1].trigger("click");
  expect(confirm).toHaveBeenCalledTimes(1);
  wrapper.unmount();
});

test("a user-provided value is not translated or interpreted as a source phrase", () => {
  initializeLocale(null);
  const wrapper = mount(SystemDialogText, { props: { source: "管理账号 {username}", values: { username: "工艺核算" } }, global: { stubs } });
  expect(wrapper.text()).toBe("Manage account 工艺核算");
  wrapper.unmount();
});
