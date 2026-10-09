<template>
  <div class="stock-evidence">
    <div class="stock-evidence-overview">
      <StructurePreview :smiles="result.smiles" label="规范化结构"
        :width="560" :height="180" data-cy="stock-evidence-structure" />
      <section v-if="record" class="stock-supplier-evidence" :aria-label="$tr('选中供应商目录证据')">
        <h3>{{ record.source || $tr('供应商未记录') }}</h3>
        <dl class="stock-evidence-fields">
          <dt>{{ $tr('目录号') }}</dt><dd class="workspace-code">{{ record.catalog_id || $tr('未记录') }}</dd>
          <dt>CAS</dt><dd>{{ record.cas || $tr('未记录') }}</dd>
          <dt>{{ $tr('交期（目录）') }}</dt><dd>{{ record.lead_time?.trim() || $tr('未记录') }}</dd>
          <dt>{{ $tr('目录价格基准') }}</dt><dd><SupplierPrice :record="record" :snapshot="result.snapshot" :smiles="result.smiles" /></dd>
          <dt>{{ $tr('目录页') }}</dt><dd>
            <a v-if="safeExternalUrl(record.url)" :href="safeExternalUrl(record.url)" target="_blank" rel="noopener noreferrer" class="catalog-link">{{ $tr('查看原目录') }}<v-icon icon="mdi-open-in-new" size="12" />
            </a><span v-else>{{ $tr('未记录') }}</span>
          </dd>
        </dl>
        <p class="workspace-muted">{{ $tr('交期来自目录快照，非实时供货承诺。价格与缺失字段保持原目录依据，不代表采购资格或实验可用性。') }}</p>
      </section>
      <p v-else-if="result.records.length" class="workspace-muted">{{ $tr('未选择供应商目录记录') }}</p>
      <p v-else class="workspace-muted" role="status">{{ $tr('当前快照没有此结构的精确目录记录，未取得采购证据。') }}</p>
    </div>
    <details class="stock-query-identity">
      <summary>{{ $tr('检索身份与快照') }}</summary>
      <dl class="stock-evidence-fields">
        <dt>{{ $tr('原始查询') }}</dt><dd class="workspace-code">{{ result.query }}</dd>
        <dt>{{ $tr('规范化结构') }}</dt><dd class="workspace-code">{{ result.smiles }}</dd>
        <dt>{{ $tr('目录查询结果') }}</dt><dd>{{ result.records.length ? $tr('{count} 条精确目录记录', { count: result.records.length }) : $tr('无精确目录记录') }}</dd>
        <dt>{{ $tr('响应快照 SHA256') }}</dt><dd class="workspace-code">{{ result.snapshot }}</dd>
        <template v-if="result.expectedSnapshot">
          <dt>{{ $tr('任务快照 SHA256') }}</dt><dd class="workspace-code">{{ result.expectedSnapshot }}</dd>
          <dt>{{ $tr('快照比较') }}</dt><dd :class="{ 'tool-error': snapshotMatches === false }">
            {{ snapshotMatches ? $tr('与任务快照一致') : $tr('快照不同：当前目录记录不属于原任务快照') }}
          </dd>
        </template>
      </dl>
    </details>
  </div>
</template>

<script setup>
import SupplierPrice from "@/components/routes/SupplierPrice.vue";
import StructurePreview from "@/components/workspace/StructurePreview.vue";
import { safeExternalUrl } from "@/common/external-url";
defineProps({ result: { type: Object, required: true }, record: { type: Object, default: null }, snapshotMatches: { type: Boolean, default: null } });
</script>

<style scoped>
.stock-evidence { min-width: 0; }
.stock-evidence-overview { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start; }
.stock-evidence-overview > * { min-width: 0; }
.stock-evidence h3 { font-size: 14px; margin: 0 0 16px; overflow-wrap: anywhere; }
.stock-evidence-fields { display: grid; grid-template-columns: minmax(90px, 150px) minmax(0, 1fr); gap: 10px 16px; margin: 0; font-size: 13px; }
.stock-evidence-fields dt { color: var(--ws-muted); }
.stock-evidence-fields dd { margin: 0; overflow-wrap: anywhere; }
.stock-query-identity { margin-top: 24px; padding-top: 12px; border-top: 1px solid var(--ws-border); }
.stock-query-identity summary { min-height: 40px; padding: 10px 0; font-size: 13px; font-weight: 600; cursor: pointer; }
.stock-query-identity summary:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: 2px; }
.stock-query-identity .stock-evidence-fields { padding: 12px 0; }
.stock-evidence p { font-size: 12px; line-height: 1.6; margin: 16px 0 0; }
.catalog-link { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; font-size: 12px; text-decoration: underline; }
@media (max-width: 900px) {
  .stock-evidence-overview { grid-template-columns: minmax(0, 1fr); gap: 20px; }
}
@media (max-width: 480px) {
  .stock-evidence-fields { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .stock-evidence-fields dd { margin-bottom: 10px; }
}
</style>
