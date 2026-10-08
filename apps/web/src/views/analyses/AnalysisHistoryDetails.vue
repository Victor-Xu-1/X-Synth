<template>
  <WorkbenchDialog :model-value="modelValue && !!record" max-width="720" :aria-labelledby="titleId"
    @update:model-value="$emit('update:modelValue', $event)" @after-leave="$emit('afterLeave')">
    <section v-if="record" class="history-record-details">
      <header>
        <div>
          <h2 :id="titleId">{{ $tr('{name}记录', { name: $tr(analysisKinds[record.kind].title) }) }}</h2>
          <span class="history-record-status">{{ $tr(analysisStatuses[record.status]) }}</span>
        </div>
        <v-btn icon="mdi-close" variant="text" :aria-label="$tr('关闭')" :title="$tr('关闭')"
          @click="$emit('update:modelValue', false)" />
      </header>
      <div class="history-record-body">
        <SmilesImage v-if="record.structure" class="history-record-preview" :smiles="record.structure"
          :width="640" :height="220" :show-error-image="false" />
        <dl>
          <div v-if="record.structure" class="history-record-structure">
            <dt>SMILES</dt><dd><code class="analysis-structure-text">{{ record.structure }}</code></dd>
          </div>
          <div><dt>{{ $tr('记录标识') }}</dt><dd class="history-record-id">{{ record.id }}</dd></div>
          <div><dt>{{ $tr('提交时间') }}</dt><dd><time :datetime="record.created">{{ recordDate(record.created) }}</time></dd></div>
          <div v-if="record.finished"><dt>{{ $tr('结束时间') }}</dt><dd><time :datetime="record.finished">{{ recordDate(record.finished) }}</time></dd></div>
        </dl>
        <p v-if="record.error" class="history-record-error">{{ record.error }}</p>
      </div>
    </section>
  </WorkbenchDialog>
</template>
<script setup>
import { useId } from "vue";
import { analysisKinds, analysisStatuses, recordDate } from "@/common/analysis-records";
import WorkbenchDialog from "@/components/workspace/WorkbenchDialog.vue";
import SmilesImage from "@/components/SmilesImage.vue";
defineProps({ modelValue: Boolean, record: { type: Object, default: null } });
defineEmits(["update:modelValue", "afterLeave"]);
const titleId = useId();
</script>
<style scoped>
.history-record-details { display: flex; flex-direction: column; max-height: calc(100dvh - 48px); min-width: 0; overflow: hidden; background: var(--ws-surface); color: var(--ws-text); border: 1px solid var(--ws-border); border-radius: 8px; font-size: 14px; letter-spacing: 0; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--ws-border); }
header > div { min-width: 0; }
h2 { margin: 0 0 4px; font-size: 18px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
.history-record-status { color: var(--ws-muted); font-size: 12px; }
header :deep(.v-btn) { flex-shrink: 0; width: 44px; height: 44px; min-width: 44px; color: var(--ws-muted); border-radius: 6px; }
.history-record-details :deep(.v-btn:focus-visible) { outline: 2px solid var(--ws-accent); outline-offset: 2px; }
.history-record-body { overflow-y: auto; padding: 20px; }
.history-record-preview { width: 100%; height: 220px; margin-bottom: 20px; }
.history-record-preview :deep(.v-img) { width: 100% !important; height: 100% !important; }
.history-record-preview :deep(.structure-error-state > span) { display: none; }
.history-record-preview :deep(.structure-error-state .v-btn) { width: 44px; height: 44px; }
dl { display: grid; gap: 14px; margin: 0; }
dl > div { display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 8px 16px; }
dt { color: var(--ws-muted); font-size: 12px; }
dd { margin: 0; min-width: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.analysis-structure-text,
.history-record-id { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.history-record-error { margin: 20px 0 0; padding-top: 16px; border-top: 1px solid var(--ws-border); color: var(--ws-danger); overflow-wrap: anywhere; white-space: pre-wrap; }
@media (max-width: 599px) {
  header { padding: 12px 16px; }
  .history-record-body { padding: 16px; }
  dl > div { grid-template-columns: minmax(0, 1fr); gap: 4px; }
}
</style>
