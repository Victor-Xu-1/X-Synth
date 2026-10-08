<template>
  <div class="stock-evidence">
    <section aria-label="检索身份与快照">
      <h3>检索身份与快照</h3>
      <dl class="stock-evidence-fields">
        <dt>原始查询</dt><dd class="workspace-code">{{ result.query }}</dd>
        <dt>规范化结构</dt><dd class="workspace-code">{{ result.smiles }}</dd>
        <dt>目录查询结果</dt><dd>{{ result.records.length ? `${result.records.length} 条精确目录记录` : "无精确目录记录" }}</dd>
        <dt>响应快照 SHA256</dt><dd class="workspace-code">{{ result.snapshot }}</dd>
        <template v-if="result.expectedSnapshot">
          <dt>任务快照 SHA256</dt><dd class="workspace-code">{{ result.expectedSnapshot }}</dd>
          <dt>快照比较</dt><dd :class="{ 'tool-error': snapshotMatches === false }">
            {{ snapshotMatches ? "与任务快照一致" : "快照不同：当前目录记录不属于原任务快照" }}
          </dd>
        </template>
      </dl>
    </section>
    <section v-if="record" class="stock-supplier-evidence" aria-label="选中供应商目录证据">
      <h3>{{ record.source || "供应商未记录" }}</h3>
      <dl class="stock-evidence-fields">
        <dt>目录号</dt><dd class="workspace-code">{{ record.catalog_id || "未记录" }}</dd>
        <dt>CAS</dt><dd>{{ record.cas || "未记录" }}</dd>
        <dt>交期（目录）</dt><dd>{{ record.lead_time?.trim() || "未记录" }}</dd>
        <dt>目录价格基准</dt><dd><SupplierPrice :record="record" :snapshot="result.snapshot" :smiles="result.smiles" /></dd>
        <dt>目录页</dt><dd>
          <a v-if="safeExternalUrl(record.url)" :href="safeExternalUrl(record.url)" target="_blank" rel="noopener noreferrer" class="catalog-link">
            查看原目录 <v-icon icon="mdi-open-in-new" size="12" />
          </a><span v-else>未记录</span>
        </dd>
      </dl>
      <p class="workspace-muted">交期来自目录快照，非实时供货承诺。价格与缺失字段保持原目录依据，不代表采购资格或实验可用性。</p>
    </section>
    <p v-else-if="result.records.length" class="workspace-muted">未选择供应商目录记录</p>
  </div>
</template>

<script setup>
import SupplierPrice from "@/components/routes/SupplierPrice.vue";
import { safeExternalUrl } from "@/common/external-url";
defineProps({ result: { type: Object, required: true }, record: { type: Object, default: null }, snapshotMatches: { type: Boolean, default: null } });
</script>

<style scoped>
.stock-evidence { min-width: 0; }
.stock-evidence h3 { font-size: 14px; margin: 0 0 16px; overflow-wrap: anywhere; }
.stock-evidence-fields { display: grid; grid-template-columns: minmax(90px, 150px) minmax(0, 1fr); gap: 10px 16px; margin: 0; font-size: 13px; }
.stock-evidence-fields dt { color: var(--ws-muted); }
.stock-evidence-fields dd { margin: 0; overflow-wrap: anywhere; }
.stock-supplier-evidence { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--ws-border); }
.stock-evidence p { font-size: 12px; line-height: 1.6; margin: 16px 0 0; }
.catalog-link { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; font-size: 12px; text-decoration: underline; }
@media (max-width: 480px) {
  .stock-evidence-fields { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .stock-evidence-fields dd { margin-bottom: 10px; }
}
</style>
