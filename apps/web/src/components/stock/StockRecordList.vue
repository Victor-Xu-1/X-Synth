<template>
  <ul class="stock-records" aria-label="精确结构供应商目录记录">
    <li v-for="(row, index) in result.records" :key="index" class="stock-record">
      <div class="stock-record-identity">
        <h3>{{ row.source || "供应商未记录" }}</h3>
        <dl><dt>目录号</dt><dd class="workspace-code">{{ row.catalog_id || "未记录" }}</dd>
          <dt>CAS</dt><dd>{{ row.cas || "未记录" }}</dd>
          <dt>交期（目录）</dt><dd class="stock-lead-time">{{ row.lead_time?.trim() || "未记录" }}</dd></dl>
      </div>
      <div class="stock-record-price">
        <span class="stock-field-label">目录价格基准</span>
        <SupplierPrice :record="row" :snapshot="result.snapshot" :smiles="result.smiles" compact />
      </div>
      <div class="stock-record-actions">
        <button type="button" class="stock-detail-button" data-cy="stock-record-details"
          :aria-label="`查看${row.source || '供应商未记录'} ${row.catalog_id || '目录记录'}证据详情`"
          @click="$emit('select', { index, origin: $event.currentTarget })">
          <v-icon icon="mdi-text-box-search-outline" size="18" /><span>证据详情</span>
        </button>
        <a v-if="safeExternalUrl(row.url)" :href="safeExternalUrl(row.url)" target="_blank" rel="noopener noreferrer" class="catalog-link">
          目录页 <v-icon icon="mdi-open-in-new" size="12" />
        </a>
        <span v-else class="stock-field-label">目录链接未记录</span>
      </div>
    </li>
  </ul>
</template>

<script setup>
import SupplierPrice from "@/components/routes/SupplierPrice.vue";
import { safeExternalUrl } from "@/common/external-url";
defineProps({ result: { type: Object, required: true } });
defineEmits(["select"]);
</script>

<style scoped>
.stock-records { padding: 0; margin: 0; list-style: none; min-width: 0; }
.stock-record { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 220px) auto; gap: 16px; align-items: start; padding: 16px 0; border-top: 1px solid var(--ws-border); }
.stock-record-identity, .stock-record-price, .stock-record-actions { min-width: 0; }
.stock-record h3 { margin: 0 0 8px; font-size: 14px; overflow-wrap: anywhere; }
.stock-record dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; margin: 0; font-size: 12px; }
.stock-record dt, .stock-field-label { color: var(--ws-muted); font-size: 12px; }
.stock-record dd { margin: 0; overflow-wrap: anywhere; }
.stock-record-price { display: grid; gap: 6px; }
.stock-record-actions { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
.stock-detail-button { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 4px 10px; border: 1px solid var(--ws-border); border-radius: 4px; color: var(--ws-text); background: var(--ws-surface); font-size: 12px; white-space: nowrap; cursor: pointer; }
.stock-detail-button:hover { background: var(--ws-inspector); }
.stock-detail-button:focus-visible { outline: 2px solid var(--ws-accent); outline-offset: 2px; }
.catalog-link { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; font-size: 12px; text-decoration: underline; }
@media (max-width: 720px) {
  .stock-record { grid-template-columns: minmax(0, 1fr) minmax(0, 160px); }
  .stock-record-actions { grid-column: 1 / -1; flex-direction: row; align-items: center; flex-wrap: wrap; }
}
@media (max-width: 480px) {
  .stock-record { grid-template-columns: minmax(0, 1fr); gap: 12px; }
}
</style>
