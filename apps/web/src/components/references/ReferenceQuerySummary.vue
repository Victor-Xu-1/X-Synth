<template>
  <section class="reference-query-summary" data-cy="reference-query-summary" :aria-label="$tr('本次查询结构')">
    <StructurePreview :smiles="query.product" label="产物" :width="280" :height="110" />
    <dl>
      <div><dt>{{ $tr('匹配方式') }}</dt><dd>{{ $tr('产物结构精确匹配') }}</dd></div>
      <div><dt>{{ $tr('反应物') }}</dt><dd>{{ query.reactants.length }}</dd></div>
    </dl>
  </section>
</template>
<script setup>
import StructurePreview from "@/components/workspace/StructurePreview.vue";
defineProps({ query: { type: Object, required: true } });
</script>
<style scoped>
.reference-query-summary { display: grid; grid-template-columns: minmax(0, 280px) minmax(0, 1fr); align-items: center; gap: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--ws-border); }
.reference-query-summary dl { display: grid; gap: 12px; margin: 0; }
.reference-query-summary dt { font-size: 12px; color: var(--ws-muted); }
.reference-query-summary dd { margin: 4px 0 0; font-size: 13px; }
.reference-query-summary :deep(.smiles-image-container) { max-width: 100%; }
@media (max-width: 700px) {
  .reference-query-summary { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .reference-query-summary dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
