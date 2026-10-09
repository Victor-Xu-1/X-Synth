<template>
  <div class="editor-view-tools" role="group" :aria-label="$tr('绘图视图工具')">
    <span v-if="expanded" class="editor-view-title">{{ $tr(title) }}</span>
    <v-tooltip v-for="tool in tools" :key="tool.label" :text="$tr(tool.label)">
      <template #activator="{ props: activator }"><v-btn v-bind="activator" type="button"
        :icon="tool.icon" variant="text" size="small" :aria-label="$tr(tool.label)"
        :disabled="disabled" @click="$emit(tool.event)" /></template>
    </v-tooltip>
    <v-tooltip v-if="supported" :text="$tr(expanded ? '返回画板' : '放大画板')">
      <template #activator="{ props: activator }"><v-btn v-bind="activator" type="button"
        :icon="expanded ? 'mdi-arrow-collapse-all' : 'mdi-arrow-expand-all'" variant="text" size="small"
        :aria-label="$tr(expanded ? '返回画板' : '放大画板')" :aria-expanded="expanded" :disabled="disabled"
        @click="$emit('expand', $event.currentTarget)" /></template>
    </v-tooltip>
  </div>
</template>
<script setup>
defineProps({ expanded: Boolean, supported: Boolean, disabled: Boolean, title: String });
defineEmits(['zoomOut', 'zoomIn', 'fit', 'expand']);
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
