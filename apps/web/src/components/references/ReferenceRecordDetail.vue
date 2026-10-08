<template>
  <section class="reference-record-detail" data-cy="reference-record-detail" :data-reference-id="record.id">
    <header class="reference-detail-heading">
      <div class="reference-detail-identity">
        <p>{{ record.provenance.source }} · {{ referenceRecordEvidence(record) }}</p>
        <h2 :id="titleId">{{ referenceRecordTitle(record) }}</h2>
        <span>{{ record.match_scope === 'reaction_identity' ? $tr('全反应一致') : $tr('仅产物一致') }}</span>
      </div>
      <v-btn icon="mdi-close" variant="text" size="small" :aria-label="$tr('关闭参考记录详情')" data-cy="reference-detail-close" @click="$emit('close')" />
    </header>
    <div class="reference-detail-body">
      <StructurePreview :smiles="referenceReactionDrawing(record)" input-type="reaction" label="参考反应结构" :width="900" :height="160" />
      <section class="reference-detail-section" :aria-label="$tr('报道收率')">
        <h3>{{ $tr('报道收率') }}</h3>
        <ReferenceRecordYields :measurements="record.reported_yields" :products="record.products" />
      </section>
      <section class="reference-detail-section" :aria-label="$tr('记录条件与投料')">
        <h3>{{ $tr('记录条件与投料') }}</h3>
        <RecordedReactionConditions :conditions="record.conditions" />
      </section>
      <section class="reference-detail-section reference-procedure" :aria-label="$tr('实验记录')">
        <h3>{{ $tr('实验记录') }}</h3>
        <p>{{ record.procedure || $tr('未记录') }}</p>
      </section>
      <details class="reference-detail-section reference-citation" open>
        <summary>{{ $tr('引用与原始记录') }}</summary>
        <dl class="reference-provenance">
          <div v-for="citation in citations" :key="citation.url">
            <dt>{{ citation.kind === 'data' ? $tr('原始数据') : $tr('文献') }}</dt>
            <dd><a :href="citation.url" target="_blank" rel="noopener noreferrer">{{ referenceCitationLabel(citation, record) }}</a></dd>
          </div>
          <div v-if="!citations.length"><dt>{{ $tr('文献与数据') }}</dt><dd>{{ $tr('链接未记录') }}</dd></div>
          <div v-for="[label, value] in provenance" :key="label">
            <dt>{{ $tr(label) }}</dt><dd>{{ recordedValue(value) }}</dd>
          </div>
        </dl>
      </details>
      <details class="reference-detail-section reference-raw-record">
        <summary>{{ $tr('原始反应 SMILES') }}</summary>
        <code class="reference-raw">{{ record.reaction_smiles }}</code>
      </details>
    </div>
    <footer class="reference-detail-actions">
      <slot name="actions" />
      <p v-if="actionError" class="tool-error" role="alert">{{ $tr(actionError) }}</p>
      <p v-if="notice" class="reference-detail-notice" role="status">{{ $tr(notice) }}</p>
    </footer>
  </section>
</template>
<script setup>
import { computed } from "vue";
import { evidenceCitations } from "@/common/reference-evidence";
import { referenceReactionDrawing } from "@/common/reaction-references";
import StructurePreview from "@/components/workspace/StructurePreview.vue";
import RecordedReactionConditions from "./RecordedReactionConditions.vue";
import ReferenceRecordYields from "./ReferenceRecordYields.vue";
import { referenceCitationLabel, referenceRecordedValue as recordedValue, referenceRecordEvidence, referenceRecordProvenance, referenceRecordTitle } from "./reference-record";
const props = defineProps({
  record: { type: Object, required: true },
  titleId: { type: String, required: true },
  actionError: { type: String, default: "" },
  notice: { type: String, default: "" },
});
defineEmits(["close"]);
const citations = computed(() => evidenceCitations(props.record));
const provenance = computed(() => referenceRecordProvenance(props.record));
</script>
<style scoped>
.reference-record-detail { display: flex; flex-direction: column; min-width: 0; max-height: calc(100dvh - 48px); color: var(--ws-text); background: var(--ws-surface); border: 1px solid var(--ws-border); border-radius: var(--ws-radius, 6px); overflow: hidden; }
.reference-detail-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--ws-border); }
.reference-detail-identity { min-width: 0; }
.reference-detail-heading h2 { margin: 4px 0; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.reference-detail-heading p, .reference-detail-heading span { font-size: 12px; color: var(--ws-muted); margin: 0; }
.reference-detail-body { min-height: 0; overflow-y: auto; padding: 12px 20px; overscroll-behavior: contain; }
.reference-detail-section { padding: 16px 0; border-top: 1px solid var(--ws-border); font-size: 12px; overflow-wrap: anywhere; }
.reference-detail-section h3, summary { font-size: 13px; font-weight: 600; }
.reference-detail-section h3 { margin: 0 0 8px; }
.reference-detail-section :deep(.recorded-conditions) { border-top: 0; padding: 0; }
.reference-procedure p { white-space: pre-wrap; line-height: 1.7; margin: 8px 0 0; }
summary { cursor: pointer; }
.reference-provenance { display: grid; gap: 8px; margin: 12px 0 0; }
.reference-provenance > div { display: grid; grid-template-columns: 108px minmax(0, 1fr); gap: 12px; }
dt { color: var(--ws-muted); }
dd { min-width: 0; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
a { color: var(--ws-info); text-underline-offset: 3px; }
.reference-raw { display: block; margin-top: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.reference-detail-actions { flex-shrink: 0; padding: 8px 16px; border-top: 1px solid var(--ws-border); }
.reference-detail-actions p { margin: 4px; font-size: 12px; overflow-wrap: anywhere; }
.tool-error { color: var(--ws-danger); }
.reference-detail-notice { color: var(--ws-muted); }
@media (max-width: 600px) {
  .reference-record-detail { max-height: calc(100dvh - 32px); }
  .reference-detail-heading { padding: 12px; }
  .reference-detail-body { padding: 12px; }
  .reference-provenance > div { grid-template-columns: minmax(0, 1fr); gap: 3px; }
}
</style>
