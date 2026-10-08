import { flushPromises, mount } from "@vue/test-utils";
import Banlist from "@/views/banlist/Banlist.vue";
import MultiEntryDialog from "./MultiEntryDialog.vue";

export { session, deferred, jsonFile } from "./rule-protocol.test-support";

const stubs = {
  ModuleWorkbench: { template: "<main><slot /></main>" },
  WorkbenchDialog: { props: ["modelValue"], template: '<section v-show="modelValue"><slot /></section>' },
  VCard: { template: "<div><slot /></div>" },
  VCardTitle: { template: "<h2><slot /></h2>" },
  VCardText: { template: "<div><slot /></div>" },
  VCardActions: { template: "<footer><slot /></footer>" },
  VRow: { template: "<div><slot /></div>" }, VCol: { template: "<div><slot /></div>" },
  VSpacer: true, VIcon: true,
  VBtn: { props: ["disabled", "loading"], template: '<button :disabled="disabled"><slot /></button>' },
  VSelect: { props: ["modelValue", "disabled"], template: '<select :disabled="disabled" />' },
  VSwitch: { props: ["modelValue", "disabled"], template: '<button :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)" />' },
  VTextField: { props: ["modelValue", "disabled"], template: '<input :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  VFileInput: { name: "RuleFileInput", props: ["modelValue", "disabled"], template: '<input type="file" :disabled="disabled" />' },
  VTooltip: { inheritAttrs: false, template: '<slot name="activator" :props="{}" />' },
  VSnackbar: { props: ["modelValue"], template: '<aside v-if="modelValue"><slot /><slot name="actions" /></aside>' },
  VDataTable: { props: ["items", "loading"], template: '<div data-testid="rule-table"><div v-for="item in items" :key="item.id"><slot name="item.active" :item="item" /><slot name="item.delete" :item="item" /></div></div>' },
  SmilesImage: true, CopyTooltip: true,
};

export async function mountRulePage() {
  const wrapper = mount(Banlist, { global: { stubs } });
  await flushPromises();
  return wrapper;
}
export const pendingCount = (wrapper) => wrapper.vm.$.setupState.pendingTasks;
export const ruleItems = (wrapper) => {
  const table = wrapper.findComponent(stubs.VDataTable);
  return table.exists() ? table.props("items") : [];
};
export async function selectFile(wrapper, file) {
  wrapper.findComponent({ name: "RuleFileInput" }).vm.$emit("update:modelValue", file);
  await flushPromises();
}
export const upload = (wrapper) => wrapper.findComponent(MultiEntryDialog).vm.$.setupState.uploadMultipleEntries();
