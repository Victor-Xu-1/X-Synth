<template>
  <section v-if="forward.length || references.length" class="saved-step-evidence" :aria-label="$tr('已保存的步骤核验')">
    <h3>{{ $tr('已保存的步骤核验') }}</h3>
    <dl v-if="forward.length" class="saved-forward-facts">
      <template v-for="fact in forward" :key="fact.label">
        <dt>{{ $tr(fact.label) }}</dt><dd>{{ fact.controlled ? $tr(fact.value) : fact.value }}</dd>
      </template>
    </dl>
    <p v-if="forward.length" class="evidence-boundary">{{ $tr('模型计算值 · 未经实验验证') }}</p>
    <article v-for="(reference, index) in references" :key="index" class="saved-step-reference"
      :data-match-scope="reference.matchScope">
      <strong>{{ $tr(reference.matchLabel) }}</strong>
      <dl>
        <template v-if="reference.source"><dt>{{ $tr('参考来源') }}</dt><dd>{{ reference.source }}</dd></template>
        <template v-if="reference.id"><dt>{{ $tr('记录 ID') }}</dt><dd>{{ reference.id }}</dd></template>
      </dl>
      <a v-if="reference.href" :href="reference.href" target="_blank" rel="noopener noreferrer">{{ $tr('原始来源') }}</a>
      <div v-if="reference.conditionFields.length" class="saved-reference-fields">
        <span>{{ $tr('条件来源字段') }}</span>
        <code v-for="field in reference.conditionFields" :key="field">{{ field }}</code>
      </div>
      <div v-if="reference.yields.length" class="saved-reference-fields">
        <span>{{ $tr('来源收率') }}</span>
        <div v-for="(measurement, measurementIndex) in reference.yields" :key="measurementIndex" class="saved-yield">
          <strong>{{ savedYieldValue(measurement) }}</strong>
          <code v-if="measurement.product_smiles">{{ measurement.product_smiles }}</code>
          <code>{{ measurement.source_field }}</code>
        </div>
      </div>
      <p v-if="reference.matchScope === 'product_identity'" class="evidence-boundary">{{ $tr('仅产物匹配，不能证明此反应的条件或收率。') }}</p>
    </article>
    <p v-if="references.length" class="evidence-boundary">{{ $tr('结构匹配不等于当前实验已验证；仅展示已保存的来源字段。') }}</p>
  </section>
</template>
<script setup>
import { computed } from "vue";
import { savedForwardFacts, savedStepReferences, savedYieldValue } from "@/common/saved-step-evidence";
const props = defineProps({ step: Object, automatedReview: Object });
const forward = computed(() => savedForwardFacts(props.automatedReview, props.step?.step_id));
const references = computed(() => savedStepReferences(props.automatedReview, props.step?.step_id));
</script>
<style scoped>
.saved-step-evidence { min-width: 0; margin-top: 14px; font-size: 12px; }
h3 { margin: 0 0 8px; font-size: 12px; font-weight: 600; }
dl { display: grid; grid-template-columns: minmax(70px, 100px) minmax(0, 1fr); gap: 5px 8px; margin: 8px 0; }
dt, .evidence-boundary, .saved-reference-fields > span { color: var(--ws-muted); }
dd { margin: 0; overflow-wrap: anywhere; }
.saved-step-reference { padding-top: 10px; margin-top: 10px; border-top: 1px solid var(--ws-border); }
.saved-reference-fields, .saved-yield { display: grid; gap: 4px; margin-top: 8px; }
code { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
.evidence-boundary { font-size: 11px; line-height: 1.6; }
a { overflow-wrap: anywhere; }
</style>
