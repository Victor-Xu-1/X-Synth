<template>
  <v-dialog v-bind="$attrs" :model-value="presentation" :eager="opened || eager" attach
    @update:model-value="update" @after-enter="enter" @after-leave="leave">
    <template v-for="(_, name) in $slots" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps || {}" />
    </template>
  </v-dialog>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useWorkbenchActivity } from "./workbench-activity";

defineOptions({ inheritAttrs: false });
const props = defineProps({ modelValue: Boolean, eager: Boolean });
const emit = defineEmits(["update:modelValue", "afterEnter", "afterLeave"]);
const activity = useWorkbenchActivity();
const presentation = computed(() => props.modelValue && activity.value);
const opened = ref(false);
let suspendedLeave = false, disposed = false;

watch(presentation, (visible, previous) => {
  if (visible) opened.value = true;
  else if (previous) suspendedLeave = !activity.value || props.modelValue;
}, { immediate: true, flush: "sync" });

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
