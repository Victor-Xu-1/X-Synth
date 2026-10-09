<template>
  <div class="reference-record-actions" role="group" :aria-label="$tr('参考反应操作')"
    :data-reference-id="record.id" :aria-busy="exporting">
    <v-btn
      v-if="allowCanvasReuse"
      variant="text"
      size="small"
      prepend-icon="mdi-draw"
      :disabled="disabled || exporting || !exportable"
      data-cy="reference-load-reaction"
      @click="loadReaction"
    >{{ $tr('载入画板') }}</v-btn>
    <v-tooltip :text="$tr('复制原始反应 SMILES')" location="top">
      <template #activator="{ props: activator }">
        <v-btn
          v-bind="activator"
          icon="mdi-content-copy"
          variant="text"
          size="small"
          :aria-label="$tr('复制原始反应 SMILES')"
          :disabled="disabled || exporting"
          data-cy="reference-copy"
          @click="operate('copy')"
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
          :disabled="disabled || exporting || !exportable"
          :loading="exporting"
          data-cy="reference-export"
          @click="operate('export')"
        />
      </template>
    </v-tooltip>
  </div>
</template>
<script setup>
const props = defineProps({
  record: { type: Object, required: true },
  allowCanvasReuse: Boolean,
  disabled: Boolean,
  exportable: Boolean,
  exporting: Boolean,
});
const emit = defineEmits(["load-reaction", "operate"]);
function loadReaction() {
  if (!props.disabled && !props.exporting && props.allowCanvasReuse && props.exportable)
    emit("load-reaction", props.record);
}
function operate(kind) {
  if (!props.disabled && !props.exporting && (kind !== "export" || props.exportable))
    emit("operate", props.record, kind);
}
</script>
<style scoped>
.reference-record-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  min-height: 44px;
}
.reference-record-actions :deep(.v-btn) { min-height: 44px; min-width: 44px; max-width: 100%; }
.reference-record-actions :deep(.v-btn__content) { white-space: normal; }
</style>
