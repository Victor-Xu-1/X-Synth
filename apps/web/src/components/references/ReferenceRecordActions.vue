<template>
  <div class="reference-record-actions" role="group" :aria-label="$tr('参考反应操作')">
    <v-btn
      v-if="allowCanvasReuse"
      variant="text"
      size="small"
      prepend-icon="mdi-draw"
      :disabled="disabled || !exportable"
      data-cy="reference-load-reaction"
      @click="$emit('load-reaction', record)"
    >{{ $tr('载入画板') }}</v-btn>
    <v-tooltip :text="$tr('复制原始反应 SMILES')" location="top">
      <template #activator="{ props: activator }">
        <v-btn
          v-bind="activator"
          icon="mdi-content-copy"
          variant="text"
          size="small"
          :aria-label="$tr('复制原始反应 SMILES')"
          :disabled="disabled"
          data-cy="reference-copy"
          @click="$emit('operate', record, 'copy')"
        />
      </template>
    </v-tooltip>
    <v-tooltip :text="exportable ? $tr('导出完整反应 RXN') : $tr('该记录不能完整导出为 RXN')" location="top">
      <template #activator="{ props: activator }">
        <v-btn
          v-bind="activator"
          icon="mdi-download"
          variant="text"
          size="small"
          :aria-label="$tr('导出完整反应 RXN')"
          :disabled="disabled || !exportable"
          :loading="exporting"
          data-cy="reference-export"
          @click="$emit('operate', record, 'export')"
        />
      </template>
    </v-tooltip>
  </div>
</template>
<script setup>
defineProps({
  record: { type: Object, required: true },
  allowCanvasReuse: Boolean,
  disabled: Boolean,
  exportable: Boolean,
  exporting: Boolean,
});
defineEmits(["load-reaction", "operate"]);
</script>
<style scoped>
.reference-record-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  min-height: 36px;
}
</style>
