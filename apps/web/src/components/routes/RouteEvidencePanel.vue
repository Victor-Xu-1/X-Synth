<template>
  <section class="route-evidence" aria-label="路线来源与验证记录">
    <dl v-if="facts.length" class="evidence-facts">
      <template v-for="fact in facts" :key="fact.label">
        <dt>{{ fact.label }}</dt>
        <dd>{{ fact.value }}</dd>
      </template>
    </dl>
    <p v-if="candidate?.metadata?.forward_validation_method === 'native_template_reconstruction'" class="evidence-boundary">
      模板重构仅核对结构一致性，不代表独立正向预测或实验验证。
    </p>
    <section v-if="materials.length" class="evidence-section">
      <h3>起始原料 <span>{{ materials.length }}</span></h3>
      <ul class="evidence-values">
        <li v-for="smiles in materials" :key="smiles"><code>{{ smiles }}</code></li>
      </ul>
    </section>
    <section v-if="sources.length" class="evidence-section">
      <h3>闭合来源 <span>{{ sources.length }}</span></h3>
      <ul class="evidence-values">
        <li v-for="source in sources" :key="source"><code>{{ source }}</code></li>
      </ul>
      <p class="evidence-boundary">目录记录不代表实时库存或供货承诺。</p>
    </section>
    <section v-if="references.length" class="evidence-section">
      <h3>证据引用 <span>{{ references.length }}</span></h3>
      <ul class="evidence-values">
        <li v-for="reference in references" :key="reference"><code>{{ reference }}</code></li>
      </ul>
    </section>
    <details v-if="models.length" class="evidence-section">
      <summary>模型来源 · {{ models.length }}</summary>
      <dl v-for="(model, index) in models" :key="index" class="evidence-facts model-facts">
        <template v-for="fact in model" :key="fact.label">
          <dt>{{ fact.label }}</dt>
          <dd>{{ fact.value }}</dd>
        </template>
      </dl>
    </details>
    <details v-if="metadata" class="evidence-section raw-evidence">
      <summary>原始 metadata</summary>
      <pre>{{ metadata }}</pre>
    </details>
    <p v-if="candidate && !facts.length && !sources.length && !references.length && !metadata" class="evidence-boundary">未记录来源或验证证据</p>
  </section>
</template>
<script setup>
import { computed } from "vue";
import { forwardEvidence, modelEvidence, recordEvidence } from "@/common/route-details";
const props = defineProps({ candidate: Object, step: Object });
const stringList = (value) => Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string" && item
  .trim()))] : [];
const facts = computed(() => [...recordEvidence(props.step || props.candidate), ...forwardEvidence(props.candidate)]);
const materials = computed(() => stringList(props.candidate?.starting_materials));
const sources = computed(() => stringList(props.candidate?.closure_sources));
const references = computed(() => stringList(props.candidate?.evidence_refs));
const models = computed(() => modelEvidence(props.step));
const metadata = computed(() => {
  const value = (props.step || props.candidate)?.metadata;
  return value && typeof value === "object" && Object.keys(value).length ? JSON.stringify(value, null, 2) : "";
});
</script>
<style scoped>
.route-evidence { padding: 14px 0; color: var(--ws-text); min-width: 0; font-size: 12px; }
.evidence-facts { display: grid; grid-template-columns: minmax(80px, 130px) minmax(0, 1fr); gap: 8px 14px; margin: 0; }
.evidence-facts dt, .evidence-boundary { color: var(--ws-muted); }
.evidence-facts dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.evidence-section { border-top: 1px solid var(--ws-border); padding-top: 12px; margin-top: 14px; }
.evidence-section h3, .evidence-section summary { font-size: 12px; font-weight: 550; }
.evidence-section h3 span { margin-left: 8px; color: var(--ws-muted); font-weight: 400; }
.evidence-section summary { cursor: pointer; padding: 2px 0; }
.evidence-section summary:focus-visible { outline: 2px solid var(--ws-text); outline-offset: 3px; }
.evidence-values { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 6px; }
.evidence-values code, .raw-evidence pre { font: 11px/1.7 Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.evidence-boundary { font-size: 11px; line-height: 1.7; margin: 10px 0 0; }
.model-facts { margin-top: 14px; border-left: 2px solid var(--ws-border); padding-left: 12px; }
.raw-evidence pre { padding: 10px; margin: 10px 0 0; max-height: 300px; overflow: auto; background: var(--ws-bg); }
@media (max-width: 480px) { .evidence-facts { grid-template-columns: 90px minmax(0, 1fr); gap: 6px 10px; } }
</style>
