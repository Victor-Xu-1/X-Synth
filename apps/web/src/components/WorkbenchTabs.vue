<template>
  <div v-if="items.length" ref="tablist" class="workspace-tabs" role="tablist"
    :aria-label="$tr(label)" aria-orientation="horizontal" @keydown="move">
    <button v-for="item in items" :id="tabId(item.value)" :key="item.value"
      type="button" role="tab" :aria-controls="panelId(item.value)"
      :aria-selected="item.value === modelValue" :disabled="disabled || item.disabled"
      :tabindex="item.value === tabStop ? 0 : -1" :class="{ active: item.value === modelValue }"
      @click="choose(item.value)">{{ $tr(item.title) }}</button>
  </div>
  <slot :tab-id="tabId" :panel-id="panelId" />
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from "vue";

const props = defineProps({
  items: { type: Array, default: () => [] },
  modelValue: String,
  label: { type: String, required: true },
  panel: String,
  disabled: Boolean,
});
const emit = defineEmits(["update:modelValue"]);
const tablist = ref(null), id = `workbench-tabs-${crypto.randomUUID()}`;
const enabled = computed(() => props.disabled ? [] : props.items.filter((item) => !item.disabled));
const tabStop = computed(() => enabled.value.find((item) => item.value === props.modelValue)?.value || enabled.value[0]?.value);
const tabId = (value) => `${id}-tab-${encodeURIComponent(value)}`;
const panelId = (value) => props.panel || `${id}-panel-${encodeURIComponent(value)}`;
let generation = 0, disposed = false;

async function choose(value) {
  if (!enabled.value.some((item) => item.value === value)) return;
  const current = ++generation;
  emit("update:modelValue", value);
  await nextTick();
  if (disposed || current !== generation) return;
  const target = [...(tablist.value?.querySelectorAll('[role="tab"]') || [])]
    .find((button) => button.id === tabId(value));
  if (!target?.isConnected || target.disabled) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}
function move(event) {
  if (event.altKey || event.ctrlKey || event.metaKey ||
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !enabled.value.length) return;
  const focused = event.target.closest('[role="tab"]');
  const index = enabled.value.findIndex((item) => tabId(item.value) === focused?.id);
  if (index < 0) return;
  const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.value.length - 1
    : (index + (event.key === "ArrowRight" ? 1 : -1) + enabled.value.length) % enabled.value.length;
  event.preventDefault();
  choose(enabled.value[next].value);
}
onBeforeUnmount(() => { disposed = true; generation++; });
</script>

<style scoped>
.workspace-tabs button {
  flex: 0 0 auto;
  min-height: 40px;
}
.workspace-tabs button:focus-visible {
  outline: 2px solid var(--ws-accent);
  outline-offset: -4px;
}
</style>
