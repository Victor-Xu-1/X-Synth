<template>
  <div class="supplier-price" :class="{ 'supplier-price-compact': compact }">
    <span class="supplier-price-value" :title="$tr(view.note)">{{ view.amount === null ? $tr(view.text) : view.text }}</span>
    <span class="supplier-price-note">{{ compact && view.basis ? $tr('目录基准 · 币种未标注') : $tr(view.note) }}</span>
    <details v-if="!compact && view.basis" class="supplier-price-evidence">
      <summary>{{ $tr('价格依据') }}</summary>
      <dl>
        <dt>{{ $tr('原始字段') }}</dt><dd>ppg · $/g</dd>
        <dt>{{ $tr('币种 ISO') }}</dt><dd>{{ $tr('未标注') }}</dd>
        <dt>{{ $tr('报价日期') }}</dt><dd>{{ $tr('未记录') }}</dd>
        <dt>{{ $tr('包装 / 纯度') }}</dt><dd>{{ $tr('未记录') }}</dd>
        <dt>{{ $tr('目录来源') }}</dt><dd>{{ view.basis.source_id }}</dd>
        <dt>{{ $tr('源快照 SHA256') }}</dt><dd>{{ view.basis.snapshot }}</dd>
        <dt>{{ $tr('目录文件 SHA256') }}</dt><dd>{{ view.basis.catalog_sha256 }}</dd>
      </dl>
      <a :href="view.basis.unit_evidence" target="_blank" rel="noopener noreferrer">{{ $tr('ASKCOS 单位说明') }}</a>
    </details>
  </div>
</template>
<script setup>
import { computed } from "vue";
import { supplierPriceView } from "@/common/route-price";
const props = defineProps({
  record: Object,
  snapshot: String,
  smiles: String,
  compact: { type: Boolean, default: false },
});
const view = computed(() => supplierPriceView(props.record, {
  snapshot: props.snapshot, smiles: props.smiles,
}));
</script>
<style scoped>
.supplier-price {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.supplier-price-value {
  font-variant-numeric: tabular-nums;
}
.supplier-price-note {
  color: var(--ws-muted);
  font-size: 11px;
  line-height: 1.5;
}
.supplier-price-evidence {
  font-size: 11px;
}
summary {
  cursor: pointer;
  color: var(--ws-muted);
}
dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 8px;
  margin: 8px 0;
}
dt { color: var(--ws-muted); }
dd { margin: 0; }
.supplier-price-compact { gap: 2px; }
@media (max-width: 600px) {
  dl {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
  dd { margin-bottom: 6px; }
}
</style>
