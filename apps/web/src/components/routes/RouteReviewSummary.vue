<template>
  <section
    class="route-review-summary"
    :aria-label="$tr('软件自动核验与参考覆盖')"
  >
    <div class="review-heading">
      <v-icon icon="mdi-shield-search" size="16" aria-hidden="true" />{{ $tr('软件自动核验') }}
    </div>
    <dl class="review-row">
      <div class="review-item" data-review="forward">
        <dt>{{ $tr(summary.forward.status === 'ready' ? forwardTitle : '独立正向预测：') }}</dt>
        <dd>
        <template v-if="summary.forward.status === 'ready'">
          <template v-if="summary.forward.total">
            <strong>{{ $tr('{matched}/{total} 步核验匹配', { matched: summary.forward.matched, total: summary.forward.total }) }}</strong>
            <span v-if="summary.forward.top1 !== undefined" class="review-support">{{ $tr(forwardCounts, forwardCountValues) }}</span>
          </template>
          <template v-else>{{ $tr('无反应步骤') }}</template>
        </template>
        <template v-else>{{ $tr(stateLabels[summary.forward.status]) }}</template>
        </dd>
      </div>
      <div class="review-item" data-review="references">
        <dt><v-icon icon="mdi-book-open-page-variant-outline" size="16" aria-hidden="true" />{{ $tr('参考覆盖：') }}</dt>
        <dd><template v-if="summary.references.status === 'ready'">
          <template v-if="summary.references.total">{{ $tr('同反应 {value} 步 · 同产物资料 {value2} 步 · 检索未匹配 {value3} 步', { value: summary.references.reaction, value2: summary.references.product, value3: summary.references.unmatched }) }}<span v-if="summary.references.coverage?.unchecked" class="review-support">{{ $tr('· 未检索 {value} 步', { value: summary.references.coverage.unchecked }) }}</span>
          </template>
          <template v-else>{{ $tr('无反应步骤') }}</template>
        </template>
        <template v-else>{{ $tr(stateLabels[summary.references.status]) }}</template>
        </dd>
      </div>
      <div v-if="unresolved.length" class="review-item" data-review="operations">
        <dt>{{ $tr('反应操作：') }}</dt>
        <dd class="review-gap">
          <span>{{ $tr('{value} 步需过程依据', { value: unresolved.length }) }}</span>
          <button
            type="button"
            class="review-inspect"
            data-reader-action="review-operations"
            :title="$tr('定位需过程依据的步骤')"
            :aria-label="$tr('定位需过程依据的步骤')"
            :disabled="busy || inspectionEnabled?.operations !== true"
            @click="inspectReview('operations', $event)"
          ><v-icon icon="mdi-magnify" size="18" aria-hidden="true" /></button>
        </dd>
      </div>
      <div v-if="unresolvedPurchase.length" class="review-item" data-review="purchase">
        <dt>{{ $tr('采购形式') }}</dt>
        <dd class="review-gap">
          <span>{{ $tr('{value} 个原料需明确采购形式', { value: unresolvedPurchase.length }) }}</span>
          <button
            type="button"
            class="review-inspect"
            data-reader-action="review-purchase"
            :title="$tr('定位采购形式未明确的原料')"
            :aria-label="$tr('定位采购形式未明确的原料')"
            :disabled="busy || inspectionEnabled?.purchase !== true"
            @click="inspectReview('purchase', $event)"
          ><v-icon icon="mdi-magnify" size="18" aria-hidden="true" /></button>
        </dd>
      </div>
    </dl>
    <p v-if="summary.references.coverage && (summary.references.coverage.truncated || summary.references.coverage.unavailable || summary.references.coverage.unknown)" class="review-boundary" data-review="coverage">
      <span v-if="summary.references.coverage.truncated">
        {{ $tr('{value} 步还有更多参考记录。', { value: summary.references.coverage.truncated }) }}</span>
      <span v-if="summary.references.coverage.unavailable">
        {{ $tr('{value} 步部分资料源不可用。', { value: summary.references.coverage.unavailable }) }}</span>
      <span v-if="summary.references.coverage.unknown">
        {{ $tr('{value} 步的检索范围未记录。', { value: summary.references.coverage.unknown }) }}</span>
    </p>
    <p class="review-boundary">{{ $tr('模型预测不等于实测；同产物资料不证明同反应。结构匹配不验证条件与收率。') }}</p>
  </section>
</template>
<script setup>
import { computed } from "vue";
import { readRouteReviewSummary } from "./route-review-summary";
import { readRouteDeliveryReview, unresolvedOperationSteps, unresolvedPurchaseMaterials } from "@/common/delivery-review";
import { ORIGINAL_RANK_BASIS } from "@/common/forward-rank";

const props = defineProps({
  candidate: Object,
  busy: Boolean,
  inspectionEnabled: { type: Object, default: () => ({ operations: false, purchase: false }) },
});
const emit = defineEmits(["inspect-review"]);
const summary = computed(() => readRouteReviewSummary(props.candidate));
const receipt = computed(() => readRouteDeliveryReview(props.candidate?.metadata?.delivery_review));
const originalRanks = computed(() => summary.value.forward.rankBasis === ORIGINAL_RANK_BASIS);
const forwardTitle = computed(() => originalRanks.value ? "步骤核验（联合模型）："
  : "步骤核验（联合排序）：");
const forwardCounts = computed(() => originalRanks.value
  ? "联合首选 {value} · 原始首选 {value2} · 记录支持 {value3}"
  : "联合首选 {value} 步 · 实验记录支持 {value2} 步");
const forwardCountValues = computed(() => originalRanks.value
  ? { value: summary.value.forward.joint, value2: summary.value.forward.top1, value3: summary.value.forward.recorded }
  : { value: summary.value.forward.top1, value2: summary.value.forward.recorded });
const unresolved = computed(() => {
  const steps = Array.isArray(props.candidate?.steps) ? props.candidate.steps : [];
  const ids = new Set(steps.map(step => step?.step_id));
  return unresolvedOperationSteps(receipt.value).filter(step => ids.has(step.step_id));
});
const unresolvedPurchase = computed(() => {
  const materials = new Set(Array.isArray(props.candidate?.starting_materials) ? props.candidate.starting_materials : []);
  return unresolvedPurchaseMaterials(receipt.value).filter(material => materials.has(material.smiles));
});
function inspectReview(kind, event) {
  if (props.busy || props.inspectionEnabled?.[kind] !== true) return;
  const issues = kind === "operations" ? unresolved.value : unresolvedPurchase.value;
  if (issues.length) emit("inspect-review", kind, event);
}
const stateLabels = {
  missing: "未记录",
  invalid: "记录格式无效",
  unsupported: "记录版本不支持",
};
</script>
<style scoped>
.route-review-summary {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 8px 0;
  border-top: 1px solid var(--ws-border);
  color: var(--ws-text);
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.review-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));
  gap: 12px 24px;
  min-width: 0;
  margin: 8px 0;
}
.review-heading {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 550;
}
.review-item {
  min-width: 0;
}
.review-item dt {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
  color: var(--ws-muted);
}
.review-item dd { margin: 0; font-size: 13px; }
.review-item dd.review-gap {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ws-warning);
}
.review-gap span { min-width: 0; }
.review-inspect {
  box-sizing: border-box;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.review-inspect:hover:not(:disabled) { border-color: var(--ws-border); }
.review-inspect:focus-visible { outline: 2px solid var(--ws-text); outline-offset: 2px; }
.review-inspect:disabled { opacity: 0.5; cursor: default; }
.review-support { display: block; color: var(--ws-muted); font-size: 12px; }
.review-boundary[data-review="coverage"] { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.review-boundary {
  margin: 4px 0 0;
  color: var(--ws-muted);
  font-size: 11px;
}
</style>
