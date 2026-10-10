<template>
  <v-dialog ref="dialog" :key="dialogEpoch"
    v-bind="scoped ? { ...$attrs, attach: true, ...(!presentation ? { 'aria-hidden': 'true', inert: true } : {}),
      ...(!activity ? { style: [$attrs.style, { display: 'none' }] } : {}) } : $attrs"
    :model-value="presentation" :eager="eager || (opened && modelValue)"
    @update:model-value="update" @after-enter="enter" @after-leave="leave">
    <template v-for="(_, name) in $slots" #[name]="slotProps">
      <WorkbenchScope v-if="scoped && name === 'default'" :key="name" :active="presentation">
        <v-defaults-provider :defaults="overlayDefaults">
          <slot v-if="dialogTarget" :name="name" v-bind="slotProps || {}" />
        </v-defaults-provider>
      </WorkbenchScope>
      <slot v-else :name="name" v-bind="slotProps || {}" />
    </template>
  </v-dialog>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useWorkbenchScope } from "./workbench-activity";
import WorkbenchScope from "./WorkbenchScope.vue";
import { workbenchOverlayDefaults } from "./workbench-overlays";

defineOptions({ inheritAttrs: false });
const props = defineProps({ modelValue: Boolean, eager: Boolean });
const emit = defineEmits(["update:modelValue", "afterEnter", "afterLeave"]);
const scope = useWorkbenchScope();
const scoped = scope !== null;
const activity = scope ?? computed(() => true);
const presentation = computed(() => props.modelValue && activity.value);
const dialog = ref(null);
const dialogTarget = computed(() => dialog.value?.contentEl);
const overlayDefaults = computed(() => workbenchOverlayDefaults(presentation.value, dialogTarget.value));
const opened = ref(false);
const dialogEpoch = ref(0);
let suspendedLeave = false, disposed = false;

watch(presentation, (visible, previous) => {
  if (visible) opened.value = true;
  else if (previous) suspendedLeave = !activity.value || props.modelValue;
}, { immediate: true, flush: "sync" });

// An already-suspended overlay has no second leave event to release its lazy subtree.
watch(() => [props.modelValue, activity.value], ([open, active], [previousOpen]) => {
  if (previousOpen && !open && !active && !props.eager) {
    opened.value = false;
    dialogEpoch.value++;
  }
}, { flush: "sync" });

function update(value) {
  if (!disposed && activity.value) emit("update:modelValue", value);
}
function enter(...args) {
  if (!disposed && activity.value && props.modelValue) emit("afterEnter", ...args);
}
function leave(...args) {
  if (!disposed && !suspendedLeave && activity.value && !props.modelValue) emit("afterLeave", ...args);
}
onBeforeUnmount(() => { disposed = true; });
</script>
