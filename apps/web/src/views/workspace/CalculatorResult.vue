<template>
  <section ref="region" class="calculator-results" tabindex="-1" aria-labelledby="calculator-result-title">
    <header><div><span class="result-stage">{{ $tr('02 / 计算结果') }}</span><h2 id="calculator-result-title">{{ reactionMode ? $tr('反应模型评分') : $tr('结构复杂度评分') }}</h2></div>
      <v-btn variant="text" prepend-icon="mdi-pencil-outline" @click="$emit('edit')">{{ $tr('返回修改') }}</v-btn>
    </header>
    <div class="calculation-structures" :class="{ reaction: reactionMode }">
      <SmilesImage :smiles="first" :width="240" :height="170" :show-error-image="false" allow-copy />
      <v-icon v-if="reactionMode" class="reaction-arrow" icon="mdi-arrow-right" aria-hidden="true" />
      <SmilesImage v-if="reactionMode" :smiles="second" :width="240" :height="170" :show-error-image="false" allow-copy />
    </div>
    <div class="calculation-score"><span>{{ reactionMode ? $tr('反应模型评分（FF）') : $tr('合成复杂度（SCScore）') }}</span><strong>{{ score.toFixed(3) }}</strong></div>
    <p class="score-status">{{ $tr('模型计算值 · 未经实验验证') }}</p>
    <details><summary>{{ $tr('计算依据') }}</summary><dl><dt>{{ $tr('模型') }}</dt><dd>{{ reactionMode ? 'FF' : 'SCScore' }}</dd>
      <dt>{{ reactionMode ? $tr('反应物完整结构') : $tr('化合物完整结构') }}</dt><dd><code>{{ first }}</code></dd>
      <template v-if="reactionMode"><dt>{{ $tr('所选产物完整结构') }}</dt><dd><code>{{ second }}</code></dd></template>
    </dl></details>
  </section>
</template>
<script setup>
import { ref } from "vue";
import SmilesImage from "@/components/SmilesImage.vue";
defineProps({ reactionMode: Boolean, score: { type: Number, required: true }, first: { type: String, required: true }, second: { type: String, default: "" } });
defineEmits(["edit"]);
const region = ref(null);
function focus() { region.value?.focus({ preventScroll: true }); region.value?.scrollIntoView?.({ block: "nearest" }); }
defineExpose({ focus });
</script>
<style scoped>
.calculator-results { min-width: 0; padding: 20px 0; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 20px; border-bottom: 1px solid var(--ws-border); }
.result-stage { color: var(--ws-muted); font-size: 12px; }
h2 { font-size: 18px; margin-top: 6px; }
.calculation-structures { display: grid; grid-template-columns: minmax(0, 240px); justify-content: center; align-items: center; gap: 20px; padding: 30px 0; }
.calculation-structures.reaction { grid-template-columns: minmax(0, 240px) 24px minmax(0, 240px); }
.calculation-structures :deep(.v-img) { max-width: 100% !important; }
.calculation-score { display: flex; align-items: baseline; gap: 24px; border-top: 1px solid var(--ws-border); padding-top: 20px; }
.calculation-score span, .score-status { font-size: 13px; color: var(--ws-muted); }
.calculation-score strong { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.score-status { margin: 10px 0 22px; }
details { font-size: 12px; border-top: 1px solid var(--ws-border); padding-top: 18px; }
summary { cursor: pointer; }
dl { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 12px 18px; margin-top: 18px; }
dt { color: var(--ws-muted); } dd { margin: 0; overflow-wrap: anywhere; }
@media (max-width: 600px) { .calculation-structures.reaction { grid-template-columns: minmax(0, 240px); } .reaction-arrow { transform: rotate(90deg); justify-self: center; } dl { grid-template-columns: minmax(0, 1fr); gap: 6px; } dd { margin-bottom: 12px; } }
</style>
