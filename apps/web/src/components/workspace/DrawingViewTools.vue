<template>
  <div ref="root" class="editor-view-tools" role="group" :aria-label="$tr('绘图视图工具')" @keydown.esc="dismissed = true">
    <span v-if="expanded" class="editor-view-title">{{ $tr(title) }}</span>
    <v-tooltip v-for="tool in tools" :key="tool.label" :text="$tr(tool.label)" :model-value="current === tool.event"
      :open-on-hover="false" :open-on-focus="false" :transition="false" @update:model-value="value => changed(tool.event, value)">
      <template #activator="{ props: activator }"><v-btn v-bind="activator" type="button"
        :icon="tool.icon" variant="text" size="small" :aria-label="$tr(tool.label)"
        :data-view-action="tool.event"
        :disabled="disabled" @mouseenter="enter(tool.event)" @mouseleave="leave(tool.event)"
        @focus="focus(tool.event)" @blur="blur(tool.event)" @click="$emit(tool.event)" /></template>
    </v-tooltip>
    <v-tooltip v-if="supported" :text="$tr(expanded ? '返回画板' : '放大画板')" :model-value="current === 'expand'"
      :open-on-hover="false" :open-on-focus="false" :transition="false" @update:model-value="value => changed('expand', value)">
      <template #activator="{ props: activator }"><v-btn v-bind="activator" type="button"
        :icon="expanded ? 'mdi-arrow-collapse-all' : 'mdi-arrow-expand-all'" variant="text" size="small"
        :aria-label="$tr(expanded ? '返回画板' : '放大画板')" :aria-expanded="expanded" :disabled="disabled"
        @mouseenter="enter('expand')" @mouseleave="leave('expand')" @focus="focus('expand')" @blur="blur('expand')"
        @click="$emit('expand', $event.currentTarget)" /></template>
    </v-tooltip>
  </div>
</template>
<script setup>
import { computed, ref, watch } from "vue";
import { useWorkbenchActivity } from "./workbench-activity";
const props = defineProps({ expanded: Boolean, supported: Boolean, disabled: Boolean, title: String });
defineEmits(['zoomOut', 'zoomIn', 'fit', 'expand']);
const activity = useWorkbenchActivity();
const root = ref(null);
defineExpose({ focusFit() {
  if (!props.disabled && activity.value) root.value?.querySelector('[data-view-action="fit"]')?.focus({ preventScroll: true });
} });
const hovered = ref(null), focused = ref(null), target = ref(null), dismissed = ref(false);
const current = computed(() => !props.disabled && activity.value && !dismissed.value ? target.value : null);
function enter(key) { if (!props.disabled) { hovered.value = key; target.value = key; dismissed.value = false; } }
function leave(key) { if (hovered.value === key) { hovered.value = null; target.value = focused.value; } }
function focus(key) { if (!props.disabled) { focused.value = key; target.value = key; dismissed.value = false; } }
function blur(key) { if (focused.value === key) { focused.value = null; if (target.value === key) target.value = hovered.value; } }
function changed(key, value) { if (!value && current.value === key) dismissed.value = true; }
watch([() => props.expanded, () => props.supported, () => props.disabled, activity], () => {
  hovered.value = null; focused.value = null; target.value = null; dismissed.value = false;
}, { flush: "sync" });
const tools = [
  { label: '缩小画板', icon: 'mdi-minus', event: 'zoomOut' },
  { label: '画板适应窗口', icon: 'mdi-fit-to-screen-outline', event: 'fit' },
  { label: '放大画图', icon: 'mdi-plus', event: 'zoomIn' },
];
</script>
<style scoped>
.editor-view-tools { display: flex; align-items: center; justify-content: flex-end; gap: 2px; min-height: 44px; flex: none; }
.editor-view-tools :deep(.v-btn) { width: 44px; height: 44px; flex: 0 0 44px; }
.editor-view-title { margin-right: auto; font-size: 13px; font-weight: 600; overflow-wrap: anywhere; min-width: 0; }
</style>
