<template>
  <div class="impurity-result">
    <header><h2>模型可能杂质</h2><router-link v-if="result.record_id" :to="`/analyses/${encodeURIComponent(result.record_id)}`"><v-icon icon="mdi-history" size="16" />查看本次记录</router-link></header>
    <section class="major-reference"><SmilesImage :smiles="result.known_major_product.smiles" :width="240" :height="130" :show-error-image="false" /><div><strong>用户提供的主产物基准</strong><span>非预测候选；不附加实验确认分数</span></div></section>
    <p class="workspace-muted">{{ rankingCaption }} · 报告 {{ result.candidates.length }} / {{ result.execution.candidate_count_before_limit }} 个模型候选</p>
    <div v-if="result.candidates.length" class="candidate-scroll" tabindex="0" role="region" aria-label="可能杂质候选表">
      <table class="data-table impurity-table"><thead><tr><th>预测结构</th><th>来源模式</th><th>正向序列对数评分</th><th>FF 模型评分</th><th>映射置信值</th><th>结构相似度</th></tr></thead>
        <tbody><template v-for="(row, index) in result.candidates" :key="row.product"><tr>
          <td><SmilesImage :smiles="row.product" :width="230" :height="120" :show-error-image="false" /><span>{{ index + 1 }} · {{ number(row.molecular_weight_g_mol) }} g·mol⁻¹</span></td>
          <td><select v-model.number="selection[row.product]" class="workspace-input" :aria-label="`候选 ${index + 1} 来源模式`"><option v-for="(origin, i) in row.origins" :key="i" :value="i">{{ origin.mode_label }} · 来源 {{ i + 1 }}</option></select></td>
          <td>{{ number(origin(row).log_probability) }}</td><td>{{ number(origin(row).feasibility_score) }}</td><td>{{ number(origin(row).mapping_confidence) }}</td><td>{{ number(row.similarity_to_known_product) }}</td>
        </tr><tr class="origin-row"><td colspan="6"><details><summary>来源反应物与原子保留</summary><SmilesImage :smiles="origin(row).reactants" :width="420" :height="140" :show-error-image="false" />
          <p v-for="(fragment, i) in origin(row).required_fragments" :key="i">{{ fragment.smiles }} · 保留 {{ fragment.retained_atoms }} / {{ fragment.supplied_atoms }} 个原子（{{ number(fragment.fraction * 100) }}%）</p>
          <details><summary>{{ origin(row).mapping ? '当前来源的完整映射' : '历史首条来源的完整映射' }}</summary><p class="workspace-code">{{ (origin(row).mapping || row.mapping).mapped_reaction }}</p></details></details></td></tr></template></tbody>
      </table>
    </div>
    <div v-else class="workspace-empty"><h2>未返回通过映射筛选的可能杂质</h2><p>不等于无杂质、无风险或实验未检出。</p></div>
    <ul class="result-notices"><li v-for="notice in result.notices" :key="notice">{{ notice }}</li></ul>
    <details class="provenance"><summary>模型与运行来源</summary><dl>
      <dt>原生算法</dt><dd>ASKCOS 五模式（MIT）</dd><dt>原生算法 SHA256</dt><dd>{{ result.provenance.algorithm_source_sha256 }}</dd>
      <dt>集成源码 SHA256</dt><dd>{{ result.provenance.integration_source_sha256 }}</dd><dt>正向模型</dt><dd>{{ result.provenance.forward_model }}</dd>
      <dt>正向资产 SHA256</dt><dd>{{ result.provenance.forward_asset_identity }}</dd><dt>FF 模型</dt><dd>{{ result.provenance.fast_filter_model }}</dd>
      <dt>原子映射</dt><dd>{{ result.provenance.mapper_model }} · {{ result.provenance.mapper_package_version }} · {{ result.provenance.mapper_license }}</dd>
      <dt>映射资产 SHA256</dt><dd>{{ result.provenance.mapper_asset_identity }}</dd><dt>实际调用</dt><dd>正向 {{ result.execution.forward_calls }} · 映射 {{ result.execution.mapping_calls }} · 模式不匹配 {{ result.execution.mapping_rejected }}</dd>
      <dt>排序启发式</dt><dd>{{ result.provenance.ranking_strategy || '历史版本：结构相似度主排序' }}</dd>
      <dt>耗时 / s</dt><dd>{{ number(result.execution.elapsed_seconds) }}</dd>
    </dl><p><a :href="safeExternalUrl(result.provenance.mapper_reference_url)" target="_blank" rel="noopener noreferrer">RXNMapper 论文</a> · <a href="https://github.com/rxn4chemistry/rxnmapper" target="_blank" rel="noopener noreferrer">RXNMapper 源码与许可</a></p>
      <p v-for="(row, index) in result.execution.skipped_atom_only_contexts || []" :key="index" class="workspace-code">无键组合跳过：模式 {{ row.mode }} · {{ row.reactants }} · {{ row.reason }}</p>
    </details>
  </div>
</template>
<script setup>
import { computed, reactive, watch } from "vue";
import SmilesImage from "@/components/SmilesImage.vue";
import { safeExternalUrl } from "@/common/external-url";
import { IMPURITY_RANKING_STRATEGY } from "./impurity-form";
const props = defineProps({ result: { type: Object, required: true } });
const rankingCaption = computed(() => props.result.provenance.ranking_strategy === IMPURITY_RANKING_STRATEGY
  ? "按综合模型评分排序，同分参考结构相似度（不是成功概率）"
  : "按主产物结构相似度排序（历史版本）");
const selection = reactive({});
watch(() => props.result, (value) => { Object.keys(selection).forEach((key) => delete selection[key]); value.candidates.forEach((row) => { selection[row.product] = 0; }); }, { immediate: true });
const origin = (row) => row.origins[selection[row.product] || 0];
const number = (value) => Number.isFinite(value) ? value.toFixed(4) : "未提供";
</script>
<style scoped>
header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
h2 { font-size: 15px; margin: 0; }
header a { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
.major-reference { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; padding: 12px 0; }
.major-reference :deep(.smiles-image-container) { flex: 0 1 240px; width: 240px; max-width: 100%; }
.major-reference strong { font-size: 13px; }.major-reference span { display: block; font-size: 12px; color: var(--ws-muted); margin-top: 8px; }
.candidate-scroll { overflow-x: auto; }.impurity-table { min-width: 980px; }.impurity-table td { vertical-align: middle; font-variant-numeric: tabular-nums; }
.impurity-table td:first-child span { display: block; font-size: 12px; }.impurity-table select { width: 190px; }
.origin-row td { padding-top: 0; font-size: 12px; }.origin-row p { overflow-wrap: anywhere; }
summary { cursor: pointer; }.result-notices { padding-left: 20px; color: var(--ws-muted); font-size: 12px; line-height: 1.8; }
.provenance { border-top: 1px solid var(--ws-border); padding-top: 16px; font-size: 12px; }
.provenance dl { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 10px; }.provenance dt { color: var(--ws-muted); }.provenance dd { margin: 0; overflow-wrap: anywhere; }
a { text-decoration: underline; }
@media (max-width: 600px) { .provenance dl { grid-template-columns: minmax(0, 1fr); } }
</style>
