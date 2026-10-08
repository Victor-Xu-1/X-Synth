import { config } from "@vue/test-utils";

// Consumer tests use this boundary; browser checks exercise native Vuetify.
export const referenceDialogStub = {
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template: '<div v-if="modelValue" role="dialog"><slot /></div>',
};
config.global.stubs.VDialog = referenceDialogStub;
