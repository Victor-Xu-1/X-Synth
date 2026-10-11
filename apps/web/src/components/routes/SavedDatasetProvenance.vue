<template>
  <section class="saved-dataset-provenance">
    <h3>{{ $tr('已保存的数据集来源') }}</h3>
    <dl v-if="summary.length" class="dataset-facts">
      <template v-for="field in summary" :key="field.label">
        <dt>{{ $tr(field.label) }}</dt><dd>{{ field.value }}</dd>
      </template>
    </dl>
    <a v-for="link in dataset.links" :key="link.key" :href="link.href" target="_blank" rel="noopener noreferrer">
      {{ $tr(link.label) }} · {{ link.value }}
    </a>
    <details v-if="metadata.length" class="dataset-details">
      <summary>{{ $tr('技术详情') }}</summary>
      <dl class="dataset-facts">
        <template v-for="field in metadata" :key="field.label">
          <dt>{{ $tr(field.label) }}</dt><dd>{{ field.value }}</dd>
        </template>
      </dl>
    </details>
    <p>{{ $tr('数据集引用仅说明数据来源，不证明该目标反应的文献匹配、条件或收率。') }}</p>
  </section>
</template>
<script setup>
import { computed } from "vue";
const props = defineProps({ dataset: { type: Object, required: true } });
const summaryLabels = new Set(["数据集", "许可"]);
const summary = computed(() => props.dataset.fields.filter(field => summaryLabels.has(field.label)));
const metadata = computed(() => props.dataset.fields.filter(field => !summaryLabels.has(field.label)));
</script>
<style scoped>
.saved-dataset-provenance { min-width: 0; border-top: 1px solid var(--ws-border); margin-top: 14px; padding-top: 12px; font-size: 12px; }
h3 { font-size: 12px; font-weight: 550; margin-bottom: 12px; }
.dataset-facts { display: grid; grid-template-columns: minmax(80px, 130px) minmax(0, 1fr); gap: 8px 14px; margin: 0; }
dt, p { color: var(--ws-muted); }
dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
a { display: block; margin-top: 10px; overflow-wrap: anywhere; }
details { margin-top: 10px; }
summary { cursor: pointer; padding: 2px 0; }
summary:focus-visible { outline: 2px solid var(--ws-text); outline-offset: 3px; }
p { font-size: 11px; line-height: 1.7; margin: 10px 0 0; }
@media (max-width: 480px) { .dataset-facts { grid-template-columns: 90px minmax(0, 1fr); gap: 6px 10px; } }
</style>
