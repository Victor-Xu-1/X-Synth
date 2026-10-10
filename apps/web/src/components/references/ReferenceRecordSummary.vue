<template>
  <div class="reference-record-summary">
    <header class="reference-row-heading">
      <div class="reference-identity">
        <div class="reference-source-line">
          <span>{{ record.provenance.source }}</span>
          <span>{{ referenceRecordEvidence(record) }}</span>
          <span v-if="record.year">{{ record.year }}</span>
          <span v-if="record.paragraph">{{ $tr('段落 {value}', { value: record.paragraph }) }}</span>
        </div>
        <strong>{{ referenceRecordTitle(record) }}</strong>
        <div v-if="citations.length" class="reference-links">
          <a v-for="citation in citations" :key="citation.url" :href="citation.url" target="_blank" rel="noopener noreferrer">
            {{ citation.kind === 'data' ? $tr('原始数据') : referenceCitationLabel(citation, record) }}
          </a>
        </div>
      </div>
      <span
        :class="['reference-scope', { complete: record.match_scope === 'reaction_identity' }]"
        :title="record.match_scope === 'reaction_identity' ? $tr('反应物与产物结构一致') : $tr('仅产物结构一致')"
      >{{ record.match_scope === 'reaction_identity' ? $tr('全反应一致') : $tr('仅产物一致') }}</span>
    </header>
    <div class="reference-record-layout">
      <v-lazy :min-height="142">
        <StructurePreview
          :smiles="referenceReactionDrawing(record)"
          input-type="reaction"
          label="参考反应结构"
          :width="720"
          :height="110"
        />
      </v-lazy>
      <section class="reference-record-facts" :aria-label="$tr('报道收率')">
        <h4>{{ $tr('报道收率') }}</h4>
        <ReferenceRecordYields :measurements="record.reported_yields" :products="record.products" compact />
      </section>
    </div>
    <dl class="reference-comparison-conditions">
      <div v-for="field in recordedParameters" :key="field.key">
        <dt>{{ $tr(field.label) }}</dt>
        <dd v-if="record.conditions?.[field.key]?.length">
          <span v-for="(item, index) in record.conditions[field.key].slice(0, 2)" :key="index">
            {{ field.key === 'time' ? $tr('{label} {value}', { label: $tr(recordedTimeLabel(item)), value: recordedParameter(item) }) : recordedParameter(item) }}
          </span>
          <small v-if="record.conditions[field.key].length > 2">{{ $tr('另 {count} 项', { count: record.conditions[field.key].length - 2 }) }}</small>
        </dd>
        <dd v-else>{{ $tr('未记录') }}</dd>
      </div>
    </dl>
    <footer class="reference-row-actions">
      <slot name="actions" />
      <v-btn
        class="reference-details-action"
        variant="text"
        size="small"
        prepend-icon="mdi-text-box-search-outline"
        aria-haspopup="dialog"
        :aria-controls="detailId"
        :aria-label="$tr('查看参考记录详情：{name}', { name: referenceRecordTitle(record) })"
        data-cy="reference-details"
        @click="$emit('open', record, $event)"
      >{{ $tr('记录详情') }}</v-btn>
    </footer>
  </div>
</template>
<script setup>
import { computed } from "vue";
import { evidenceCitations, recordedTimeLabel } from "@/common/reference-evidence";
import { referenceReactionDrawing } from "@/common/reaction-references";
import StructurePreview from "@/components/workspace/StructurePreview.vue";
import ReferenceRecordYields from "./ReferenceRecordYields.vue";
import { recordedParameters, referenceCitationLabel, referenceParameterValue as recordedParameter, referenceRecordEvidence, referenceRecordTitle } from "./reference-record";
const props = defineProps({
  record: { type: Object, required: true },
  detailId: { type: String, required: true },
});
defineEmits(["open"]);
const citations = computed(() => evidenceCitations(props.record));
</script>
<style scoped>
.reference-record-summary, .reference-identity { min-width: 0; }
.reference-row-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.reference-source-line, .reference-links { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11px; }
.reference-source-line { color: var(--ws-muted); margin-bottom: 4px; }
.reference-source-line > span:first-child { color: var(--ws-text); font-weight: 600; }
.reference-identity > strong { display: block; font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.reference-links { margin-top: 4px; overflow-wrap: anywhere; }
a { color: var(--ws-info); text-underline-offset: 3px; }
.reference-scope { flex-shrink: 0; color: var(--ws-muted); font-size: 11px; padding-top: 2px; }
.reference-scope.complete { color: var(--ws-accent); }
.reference-record-layout { display: grid; grid-template-columns: minmax(0, 1fr) 196px; align-items: center; gap: 20px; margin: 8px 0; }
.reference-record-layout :deep(.preview-heading) { font-size: 12px; margin-bottom: 0; }
.reference-record-layout :deep(.smiles-image-container) { min-width: 0; min-height: 110px; }
.reference-record-facts { min-width: 0; border-left: 1px solid var(--ws-border); padding-left: 16px; }
h4, dt { font-size: 11px; font-weight: 400; color: var(--ws-muted); }
.reference-comparison-conditions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 10px 0; }
.reference-comparison-conditions > div { min-width: 0; }
dd { display: flex; flex-wrap: wrap; gap: 3px 10px; margin: 3px 0 0; font-size: 12px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
dd small { font-size: 11px; color: var(--ws-muted); }
.reference-row-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.reference-details-action { min-height: 44px; height: 44px; }
@media (max-width: 850px) {
  .reference-record-layout { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .reference-record-facts { border-left: 0; padding-left: 0; }
  .reference-record-facts :deep(.reference-yields) { display: flex; gap: 8px 20px; flex-wrap: wrap; }
}
@media (max-width: 600px) {
  .reference-row-heading { flex-wrap: wrap; gap: 6px; }
  .reference-comparison-conditions { gap: 8px; }
}
</style>
